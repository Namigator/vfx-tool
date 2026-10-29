// Builds a prefab from a VFX Studio export package (effect.unity.json + Textures/): one Particle System per emitter
// (shape, speed, lifetime, size/colour/opacity over life, forces, flipbook, renderer), Lights, materials per
// texture/blend, and a VfxStudioEffect that plays the timeline. Menu: Tools > VFX Studio > Import Effect...
// Command line: Unity -batchmode -quit -projectPath <p> -executeMethod VfxStudio.EditorTools.VfxStudioImporter.ImportCli -vfxPackage <dir>
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace VfxStudio.EditorTools
{
    public static class VfxStudioImporter
    {
        const string Log = "[VfxStudio] ";

        [MenuItem("Tools/VFX Studio/Import Effect...")]
        static void ImportMenu()
        {
            var file = EditorUtility.OpenFilePanel("Import VFX Studio effect", Application.dataPath, "json");
            if (string.IsNullOrEmpty(file)) return;
            try
            {
                var prefab = Import(ToAssetFolder(Path.GetDirectoryName(file)));
                EditorGUIUtility.PingObject(prefab);
                Selection.activeObject = prefab;
            }
            catch (Exception ex) { EditorUtility.DisplayDialog("VFX Studio import failed", ex.Message, "OK"); Debug.LogException(ex); }
        }

        /// <summary>-vfxPackage &lt;folder&gt;: a package folder (inside or outside the project; outside ones are copied to Assets/VfxStudioEffects/&lt;name&gt;).</summary>
        public static void ImportCli()
        {
            var dir = Arg("-vfxPackage") ?? throw new ArgumentException("-vfxPackage <folder> is required");
            var prefab = Import(ToAssetFolder(dir));
            Debug.Log(Log + "IMPORTED " + AssetDatabase.GetAssetPath(prefab));
        }

        internal static string Arg(string name)
        {
            var a = Environment.GetCommandLineArgs();
            for (int i = 0; i < a.Length - 1; i++) if (a[i] == name) return a[i + 1];
            return null;
        }

        /// <summary>Asset path ("Assets/...") of the package folder, copying it into the project first when it lives outside.</summary>
        internal static string ToAssetFolder(string dir)
        {
            var full = Path.GetFullPath(dir).Replace('\\', '/').TrimEnd('/');
            var assets = Path.GetFullPath(Application.dataPath).Replace('\\', '/');
            if (full.StartsWith(assets + "/", StringComparison.OrdinalIgnoreCase)) return "Assets" + full.Substring(assets.Length);
            if (full.StartsWith("Assets/") || full == "Assets") return full;
            var json = Path.Combine(full, "effect.unity.json");
            if (!File.Exists(json)) throw new FileNotFoundException("No effect.unity.json in " + full);
            var name = VfxEffectData.Parse(File.ReadAllText(json)).name;
            var dest = $"Assets/VfxStudioEffects/{Safe(name)}";
            CopyDir(full, Path.Combine(Path.GetDirectoryName(Application.dataPath), dest));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            return dest;
        }

        static void CopyDir(string from, string to)
        {
            Directory.CreateDirectory(to);
            foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
            foreach (var d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
        }

        static string Safe(string s) => new string((s ?? "Effect").Select(c => char.IsLetterOrDigit(c) || c == '_' || c == '-' ? c : '_').ToArray());

        public static GameObject Import(string folder)
        {
            var jsonPath = folder + "/effect.unity.json";
            AssetDatabase.ImportAsset(jsonPath, ImportAssetOptions.ForceSynchronousImport);
            var json = AssetDatabase.LoadAssetAtPath<TextAsset>(jsonPath) ?? throw new FileNotFoundException(jsonPath);
            var d = VfxEffectData.Parse(json.text);
            var textures = new Dictionary<string, Texture2D>();
            foreach (var t in d.textures ?? new string[0]) textures[t] = ImportTexture($"{folder}/Textures/{t}");
            var materials = new Dictionary<string, Material>();
            Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(Application.dataPath), folder, "Materials"));
            Material MaterialFor(string texture, string blend, float emission, VfxEmitterData stretched = null)
            {
                var key = (texture ?? "") + "|" + blend + "|" + emission.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + (stretched != null ? "|stretch" : "");
                if (materials.TryGetValue(key, out var m)) return m;
                textures.TryGetValue(texture ?? "", out var tex);
                if (tex && stretched != null) tex = StretchVariant(folder, texture, Mathf.Max(1, stretched.flipColumns), Mathf.Max(1, stretched.flipRows));
                m = MakeMaterial(tex ? tex : DefaultParticleTexture(), blend, emission);
                var path = $"{folder}/Materials/{Safe(string.IsNullOrEmpty(texture) ? "default" : Path.GetFileNameWithoutExtension(texture))}_{blend}{(emission > 0f ? "_e" + Mathf.RoundToInt(emission * 100) : "")}{(stretched != null ? "_stretch" : "")}.mat";
                AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateAsset(m, path);
                return materials[key] = m;
            }
            // Beams, like the editor: a textured layer draws ONE cell of its sheet per path (cut out as its own texture so it
            // can repeat along the path); an untextured layer a soft band with the layer's softness. Materials per layer:
            // ribbonMaterials[first .. first + count) = one per cell.
            var ribbonMats = new List<Material>();
            var ribbonFirst = new int[d.ribbons.Length]; var ribbonCount = new int[d.ribbons.Length];
            for (int li = 0; li < d.ribbons.Length; li++)
            {
                var r = d.ribbons[li];
                var blend = r.additive ? "additive" : "translucent";
                ribbonFirst[li] = ribbonMats.Count;
                var cells = textures.TryGetValue(r.texture ?? "", out var sheet) && sheet ? RibbonCells(folder, r.texture, r.Columns, r.Rows, r.tile > 0f || r.Scroll.x != 0f, r.Scroll.y != 0f) : null;
                if (cells == null) cells = new[] { BandTexture(r.softness) };
                for (int k = 0; k < cells.Length; k++)
                {
                    var m = MakeMaterial(cells[k], blend, r.emission);
                    var path = $"{folder}/Materials/{Safe(r.name)}_beam{(cells.Length > 1 ? "_c" + k : "")}.mat";
                    AssetDatabase.DeleteAsset(path);
                    AssetDatabase.CreateAsset(m, path);
                    ribbonMats.Add(m);
                }
                ribbonCount[li] = cells.Length;
            }

            var root = new GameObject(Safe(d.name));
            try
            {
                var fx = root.AddComponent<VfxStudioEffect>();
                fx.effectJson = json;
                var systems = new List<ParticleSystem>();
                foreach (var e in d.emitters)
                {
                    var ps = BuildEmitter(root.transform, e, d, e.HasMesh ? MeshMaterial(folder, e) : MaterialFor(e.texture, e.blend, e.emission, e.alignment == "velocity" ? e : null));
                    if (e.HasMesh) SetupMesh(ps, e, MeshFor(folder, e));
                    if (e.HasTrail)
                    {
                        // Trail strip: the sheet stretched along it, or (untextured) the editor's soft band across its width.
                        var t = e.trail;
                        var tm = MakeMaterial(textures.TryGetValue(t.texture ?? "", out var ttex) && ttex ? ttex : BandTexture(1f), t.blend, t.emission);
                        var tpath = $"{folder}/Materials/{Safe(e.name)}_trail.mat";
                        AssetDatabase.DeleteAsset(tpath); AssetDatabase.CreateAsset(tm, tpath);
                        ps.GetComponent<ParticleSystemRenderer>().trailMaterial = tm;
                    }
                    systems.Add(ps);
                }
                fx.systems = systems.ToArray();
                fx.lights = d.lights.Select(l => BuildLight(root.transform, l)).ToArray();
                fx.ribbonMaterials = ribbonMats.ToArray(); fx.ribbonMaterialFirst = ribbonFirst; fx.ribbonMaterialCount = ribbonCount;
                var prefabPath = $"{folder}/{Safe(d.name)}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, prefabPath, out var ok);
                if (!ok) throw new Exception("Could not save " + prefabPath);
                Debug.Log($"{Log}{prefabPath}: {d.emitters.Length} particle systems, {d.lights.Length} lights, {d.ribbons.Length} beam layers, {materials.Count + ribbonMats.Count} materials ({(GraphicsSettings.currentRenderPipeline ? "SRP " + GraphicsSettings.currentRenderPipeline.GetType().Name : "built-in pipeline")})");
                return prefab;
            }
            finally { UnityEngine.Object.DestroyImmediate(root); }
        }

        static Texture2D ImportTexture(string path)
        {
            if (AssetImporter.GetAtPath(path) is TextureImporter ti)
            {
                ti.textureType = TextureImporterType.Default;
                ti.alphaIsTransparency = true; ti.sRGBTexture = true; ti.mipmapEnabled = true;
                ti.wrapMode = TextureWrapMode.Clamp; ti.npotScale = TextureImporterNPOTScale.None;
                ti.textureCompression = TextureImporterCompression.Uncompressed;
                ti.SaveAndReimport();
            }
            var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (!tex) Debug.LogWarning(Log + "missing texture " + path + " (soft default used)");
            return tex;
        }

        /// <summary>
        /// Stretched billboards run the texture's horizontal axis along the motion and ignore particle rotation, so
        /// velocity-aligned sprites get a copy of their sheet with every cell turned a quarter (grid and frame order
        /// kept): the cell's top (flame tip, streak head) then points along the motion, as in the editor.
        /// </summary>
        static Texture2D StretchVariant(string folder, string texture, int cols, int rows)
        {
            var src = $"{folder}/Textures/{texture}";
            var dst = $"{folder}/Textures/{Path.GetFileNameWithoutExtension(texture)}.stretch.png";
            var root = Path.GetDirectoryName(Application.dataPath);
            var img = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!img.LoadImage(File.ReadAllBytes(Path.Combine(root, src)))) return AssetDatabase.LoadAssetAtPath<Texture2D>(src);
            int w = img.width, h = img.height, cw = w / cols, ch = h / rows, n = Mathf.Min(cw, ch);
            var a = img.GetPixels32(); var b = new Color32[a.Length];
            for (int cy = 0; cy < rows; cy++) for (int cx = 0; cx < cols; cx++)
                for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
                {
                    // Pixel (x, y) of the cell (origin bottom-left) moves to (y, n-1-x) when StretchClockwise (top -> right),
                    // else to (n-1-y, x) (top -> left).
                    int nx = StretchClockwise ? y : n - 1 - y, ny = StretchClockwise ? n - 1 - x : x;
                    b[(cy * ch + ny) * w + cx * cw + nx] = a[(cy * ch + y) * w + cx * cw + x];
                }
            img.SetPixels32(b); img.Apply();
            File.WriteAllBytes(Path.Combine(root, dst), img.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(img);
            AssetDatabase.ImportAsset(dst, ImportAssetOptions.ForceSynchronousImport);
            return ImportTexture(dst);
        }
        /** Which way StretchVariant turns cells; the motion runs toward the texture's +U (checked visually). */
        internal static bool StretchClockwise = true;

        /// <summary>Untextured beams: alpha across the strip (V) = 1 - smoothstep(1 - softness, 1, |2v - 1|), constant along
        /// it (U) - the editor's RIBBON_FRAGMENT soft edge (softness 0 = hard edge). One generated texture per softness.</summary>
        static Texture2D BandTexture(float softness)
        {
            int pct = Mathf.RoundToInt(Mathf.Clamp01(softness) * 100f);
            var path = $"Assets/VfxStudioEffects/vfxstudio-band-s{pct}.png";
            var existing = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (existing) return existing;
            const int n = 64;
            float s = pct / 100f;
            var t = new Texture2D(8, n, TextureFormat.RGBA32, false);
            for (int y = 0; y < n; y++)
            {
                float v = Mathf.Abs((y + .5f) / n - .5f) * 2f, a = s > 0f ? 1f - SmoothStep(1f - s, 1f, v) : 1f;
                for (int x = 0; x < 8; x++) t.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(Application.dataPath), "Assets/VfxStudioEffects"));
            File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(Application.dataPath), path), t.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(t);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            return ImportTexture(path);
        }
        /// <summary>GLSL smoothstep (Mathf.SmoothStep interpolates between two values instead).</summary>
        static float SmoothStep(float e0, float e1, float x) { float u = Mathf.Clamp01((x - e0) / (e1 - e0)); return u * u * (3f - 2f * u); }

        /// <summary>
        /// Every cell of a beam's sheet as its own texture (cell k = column k % cols, row k / cols counted from the TOP, like
        /// the editor and Godot), so a LineRenderer can stretch or repeat one cell along a path instead of the whole atlas
        /// (Helix strands drew doubled lines). Repeat wrap only on the axes that tile or scroll.
        /// </summary>
        static Texture2D[] RibbonCells(string folder, string texture, int cols, int rows, bool wrapU, bool wrapV)
        {
            var root = Path.GetDirectoryName(Application.dataPath);
            var img = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            if (!img.LoadImage(File.ReadAllBytes(Path.Combine(root, $"{folder}/Textures/{texture}")))) return null;
            int cw = Mathf.Max(1, img.width / cols), ch = Mathf.Max(1, img.height / rows), count = Mathf.Min(cols * rows, 64);
            var outTex = new Texture2D[count];
            for (int k = 0; k < count; k++)
            {
                int cx = k % cols, cyTop = k / cols, y0 = (rows - 1 - cyTop) * ch; // pixel rows start at the bottom
                var cell = new Texture2D(cw, ch, TextureFormat.RGBA32, false);
                cell.SetPixels(img.GetPixels(cx * cw, y0, cw, ch)); cell.Apply();
                var dst = $"{folder}/Textures/{Path.GetFileNameWithoutExtension(texture)}.beam{(cols * rows > 1 ? "-c" + k : "")}{(wrapU ? "u" : "")}{(wrapV ? "v" : "")}.png";
                File.WriteAllBytes(Path.Combine(root, dst), cell.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(cell);
                AssetDatabase.ImportAsset(dst, ImportAssetOptions.ForceSynchronousImport);
                outTex[k] = ImportTexture(dst);
                if (AssetImporter.GetAtPath(dst) is TextureImporter ti)
                {
                    ti.wrapModeU = wrapU ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
                    ti.wrapModeV = wrapV ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
                    ti.SaveAndReimport();
                    outTex[k] = AssetDatabase.LoadAssetAtPath<Texture2D>(dst);
                }
            }
            UnityEngine.Object.DestroyImmediate(img);
            return outTex;
        }

        static Texture2D _soft;
        /// <summary>Soft round dot for untextured sprites (generated once, saved in the VfxStudio folder).</summary>
        static Texture2D DefaultParticleTexture()
        {
            if (_soft) return _soft;
            const string path = "Assets/VfxStudioEffects/vfxstudio-soft-dot.png";
            _soft = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (_soft) return _soft;
            const int n = 64;
            var t = new Texture2D(n, n, TextureFormat.RGBA32, false);
            for (int y = 0; y < n; y++) for (int x = 0; x < n; x++)
            {
                float r = Vector2.Distance(new Vector2(x + .5f, y + .5f), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                float a = 1f - Mathf.SmoothStep(0.6f, 1f, r);
                t.SetPixel(x, y, new Color(1, 1, 1, a));
            }
            Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(Application.dataPath), "Assets/VfxStudioEffects"));
            File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(Application.dataPath), path), t.EncodeToPNG());
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            return _soft = ImportTexture(path);
        }

        /// <summary>Unlit particle material: URP Particles/Unlit when a render pipeline is active, else the built-in legacy particle shaders.</summary>
        static Material MakeMaterial(Texture2D tex, string blend, float emission)
        {
            bool additive = blend == "additive";
            float boost = 1f + Mathf.Max(0f, emission); // editor: colour x (1 + emission), HDR
            Material m;
            if (GraphicsSettings.currentRenderPipeline)
            {
                var sh = Shader.Find("Universal Render Pipeline/Particles/Unlit") ?? throw new Exception("URP Particles/Unlit shader not found");
                m = new Material(sh);
                m.SetTexture("_BaseMap", tex);
                // Material colours are sRGB: encode the linear gain or (1 + emission) became ~gain^2.2 and clipped to white
                // (URP grid column: purple beams, gold rings and cyan sprites all drew white, 2026-10-30).
                float g = Mathf.LinearToGammaSpace(boost);
                m.SetColor("_BaseColor", new Color(g, g, g, 1f));
                m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", additive ? 2f : 0f);
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
                m.SetFloat("_ZWrite", 0f);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                // No _ALPHAMODULATE_ON: that is the Multiply mode keyword and pulled every additive colour toward white as its
                // alpha fell (URP grid column, 2026-10-30). _Blend 2 alone is URP additive.
                m.renderQueue = (int)RenderQueue.Transparent;
            }
            else
            {
                var sh = Shader.Find(additive ? "Legacy Shaders/Particles/Additive" : "Legacy Shaders/Particles/Alpha Blended");
                if (!sh) throw new Exception("Built-in legacy particle shaders not found");
                m = new Material(sh);
                m.SetTexture("_MainTex", tex);
                m.SetColor("_TintColor", new Color(0.5f * boost, 0.5f * boost, 0.5f * boost, 0.5f)); // these shaders double the tint: 0.5 = neutral
            }
            return m;
        }

        static ParticleSystem.MinMaxCurve Range(float a, float b) => Mathf.Approximately(a, b) ? new ParticleSystem.MinMaxCurve(a) : new ParticleSystem.MinMaxCurve(Mathf.Min(a, b), Mathf.Max(a, b));

        static AnimationCurve Linear(float[] t, float[] v, float scale)
        {
            var keys = new Keyframe[t.Length];
            for (int i = 0; i < t.Length; i++) keys[i] = new Keyframe(t[i], v[i] * scale);
            var c = new AnimationCurve(keys);
            for (int i = 0; i < keys.Length; i++) { AnimationUtility.SetKeyLeftTangentMode(c, i, AnimationUtility.TangentMode.Linear); AnimationUtility.SetKeyRightTangentMode(c, i, AnimationUtility.TangentMode.Linear); }
            return c;
        }

        /// <summary>Unity gradients hold at most 8 colour and 8 alpha keys: keep the ends and the most important inner keys.</summary>
        static int[] Pick(float[] t, Func<int, float> error)
        {
            int n = t.Length;
            if (n <= 8) return Enumerable.Range(0, n).ToArray();
            var keep = new List<int> { 0, n - 1 };
            var inner = Enumerable.Range(1, n - 2).OrderByDescending(error).Take(6);
            keep.AddRange(inner);
            keep.Sort();
            return keep.ToArray();
        }

        static Gradient ColorOverLife(VfxEmitterData e) => MakeGradient(e.colorKeysT, e.colorKeysRgb, e.alphaKeysT, e.alphaKeysV);

        static Gradient MakeGradient(float[] colorT, float[] rgb, float[] alphaT, float[] alphaV)
        {
            var g = new Gradient();
            GradientColorKey[] ck;
            if (colorT != null && colorT.Length > 0)
            {
                Color C(int i) => new Color(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
                var idx = Pick(colorT, i => { var a = C(i - 1); var b = C(i + 1); float u = Mathf.InverseLerp(colorT[i - 1], colorT[i + 1], colorT[i]); var m = Color.Lerp(a, b, u); var c = C(i); return Mathf.Abs(c.r - m.r) + Mathf.Abs(c.g - m.g) + Mathf.Abs(c.b - m.b); });
                ck = idx.Select(i => new GradientColorKey(C(i), colorT[i])).ToArray();
            }
            else ck = new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) };
            GradientAlphaKey[] ak;
            if (alphaT != null && alphaT.Length > 0)
            {
                var idx = Pick(alphaT, i => Mathf.Abs(alphaV[i] - Mathf.Lerp(alphaV[i - 1], alphaV[i + 1], Mathf.InverseLerp(alphaT[i - 1], alphaT[i + 1], alphaT[i]))));
                ak = idx.Select(i => new GradientAlphaKey(alphaV[i], alphaT[i])).ToArray();
            }
            else ak = new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(1f, 1f) };
            g.SetKeys(ck, ak);
            return g;
        }

        static ParticleSystem BuildEmitter(Transform root, VfxEmitterData e, VfxEffectData d, Material mat)
        {
            var go = new GameObject(e.name);
            go.transform.SetParent(root, false);
            go.transform.localPosition = VfxEffectData.V(e.position);
            var axis = VfxEffectData.V(e.direction);
            go.transform.localRotation = axis.sqrMagnitude > 1e-8f ? Quaternion.FromToRotation(Vector3.forward, axis.normalized) : Quaternion.identity;
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            float lifeMax = Mathf.Max(0.017f, e.lifetimeMax), lifeMin = Mathf.Clamp(e.lifetimeMin, 0.017f, lifeMax);
            float peakRate = e.rateValues != null && e.rateValues.Length > 0 ? e.rateValues.Max() : 0f;
            int burstMax = e.burstCounts != null && e.burstCounts.Length > 0 ? e.burstCounts.Sum() : 0;

            var main = ps.main;
            main.duration = Mathf.Max(0.05f, d.durationTicks / (float)d.ticksPerSecond);
            main.loop = true; main.playOnAwake = false; main.prewarm = false;
            main.startLifetime = Range(lifeMin, lifeMax);
            main.startSpeed = Range(e.speedMin, e.speedMax);
            main.startSize = Range(e.sizeMin, e.sizeMax);
            bool velocity = e.alignment == "velocity";
            // Stretched billboards ignore rotation; their sheet is turned instead (StretchVariant).
            main.startRotation = velocity ? new ParticleSystem.MinMaxCurve(0f) : Range(e.spinMinDeg * Mathf.Deg2Rad, e.spinMaxDeg * Mathf.Deg2Rad);
            main.startColor = Color.white;
            main.gravityModifier = 0f;
            main.simulationSpace = e.attachToSource ? ParticleSystemSimulationSpace.Local : ParticleSystemSimulationSpace.World;
            main.scalingMode = ParticleSystemScalingMode.Hierarchy;
            main.maxParticles = Mathf.Clamp(Mathf.CeilToInt((peakRate * lifeMax + burstMax) * 1.25f) + 16, 16, 100000);
            main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
            main.stopAction = ParticleSystemStopAction.None;
            ps.useAutoRandomSeed = false; ps.randomSeed = (uint)(e.name.GetHashCode() & 0x7fffffff);

            var em = ps.emission; em.enabled = true; em.rateOverTime = 0f; em.SetBursts(new ParticleSystem.Burst[0]);

            var sh = ps.shape; sh.enabled = true; sh.radiusThickness = 1f; sh.arc = 360f;
            switch (e.shape)
            {
                case "sphere": sh.shapeType = ParticleSystemShapeType.Sphere; sh.radius = Mathf.Max(0.0001f, e.radius); break;
                case "box": sh.shapeType = ParticleSystemShapeType.Box; sh.scale = VfxEffectData.V(e.boxSize); break;
                case "disc": sh.shapeType = ParticleSystemShapeType.Circle; sh.radius = Mathf.Max(0.0001f, e.radius); sh.radiusThickness = 0f; break;
                case "cone": sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = Mathf.Clamp(e.angleDeg, 0f, 90f); sh.radius = Mathf.Max(0.0001f, e.radius); break;
                default: sh.shapeType = ParticleSystemShapeType.Cone; sh.angle = 0f; sh.radius = 0.0001f; break;
            }

            var acc = VfxEffectData.V(e.acceleration);
            if (acc.sqrMagnitude > 1e-8f)
            {
                var f = ps.forceOverLifetime; f.enabled = true; f.space = ParticleSystemSimulationSpace.World;
                f.x = acc.x; f.y = acc.y; f.z = acc.z;
            }
            if (e.drag > 0f)
            {
                var lv = ps.limitVelocityOverLifetime; lv.enabled = true;
                lv.limit = 100000f; lv.dampen = 0f; lv.drag = e.drag;
                lv.multiplyDragByParticleSize = false; lv.multiplyDragByParticleVelocity = false;
            }
            if (e.hasNoise)
            {
                // Our curl noise is an acceleration (m/s²); the Noise module offsets velocity: strength ~ amplitude x 0.15.
                var n = ps.noise; n.enabled = true; n.strength = e.noiseAmplitude * 0.15f; n.frequency = Mathf.Max(0.05f, e.noiseFrequency);
                n.scrollSpeed = 0.5f; n.damping = true; n.octaveCount = 2; n.quality = ParticleSystemNoiseQuality.Medium;
            }
            if (e.hasAttract || e.hasVortex)
            {
                var ff = new GameObject("ForceField").AddComponent<ParticleSystemForceField>();
                ff.transform.SetParent(root, false);
                ff.transform.localPosition = VfxEffectData.V(e.hasAttract ? e.attractPosition : e.vortexPosition);
                var ax = VfxEffectData.V(e.vortexAxis);
                if (e.hasVortex && ax.sqrMagnitude > 1e-8f) ff.transform.localRotation = Quaternion.FromToRotation(Vector3.up, ax.normalized);
                ff.shape = ParticleSystemForceFieldShape.Sphere; ff.startRange = 0f; ff.endRange = 100f;
                if (e.hasAttract) ff.gravity = e.attractStrength;
                if (e.hasVortex) { ff.rotationSpeed = e.vortexStrength; ff.rotationAttraction = e.vortexInward > 0f ? 0.5f : 0f; }
                var ext = ps.externalForces; ext.enabled = true; ext.influenceFilter = ParticleSystemGameObjectFilter.List; ext.AddInfluence(ff);
            }
            if (e.hasCollision)
            {
                var plane = new GameObject("Ground").transform; plane.SetParent(root, false); plane.localPosition = new Vector3(0f, e.groundY, 0f);
                var c = ps.collision; c.enabled = true; c.type = ParticleSystemCollisionType.Planes; c.SetPlane(0, plane);
                c.bounce = e.collisionMode == "bounce" ? e.restitution : 0f;
                c.dampen = e.collisionMode == "stop" ? 1f : 0f;
                c.lifetimeLoss = e.collisionMode == "kill" ? 1f : 0f;
                c.radiusScale = 0.3f;
            }
            if (e.sizeKeysT != null && e.sizeKeysT.Length > 0)
            {
                float peak = Mathf.Max(1e-4f, e.sizeKeysV.Max());
                var so = ps.sizeOverLifetime; so.enabled = true; so.size = new ParticleSystem.MinMaxCurve(peak, Linear(e.sizeKeysT, e.sizeKeysV, 1f / peak));
            }
            var col = ps.colorOverLifetime; col.enabled = true; col.color = new ParticleSystem.MinMaxGradient(ColorOverLife(e));
            if (!velocity && (e.angularVelocityMinDeg != 0f || e.angularVelocityMaxDeg != 0f))
            {
                var rot = ps.rotationOverLifetime; rot.enabled = true; rot.z = Range(e.angularVelocityMinDeg * Mathf.Deg2Rad, e.angularVelocityMaxDeg * Mathf.Deg2Rad);
            }
            int frames = Mathf.Max(1, e.flipColumns) * Mathf.Max(1, e.flipRows);
            if (frames > 1)
            {
                var ts = ps.textureSheetAnimation; ts.enabled = true; ts.mode = ParticleSystemAnimationMode.Grid;
                ts.numTilesX = Mathf.Max(1, e.flipColumns); ts.numTilesY = Mathf.Max(1, e.flipRows);
                ts.animation = ParticleSystemAnimationType.WholeSheet;
                if (e.flipFps > 0f)
                {
                    // Frames per second over a particle's life: how many times the sheet plays per (mean) lifetime.
                    float cycles = e.flipFps * (lifeMin + lifeMax) / 2f / frames;
                    if (cycles >= 1f) { ts.cycleCount = Mathf.Max(1, Mathf.RoundToInt(e.flipLoop ? cycles : 1f)); ts.frameOverTime = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0f, 1f, 1f)); }
                    else { ts.cycleCount = 1; ts.frameOverTime = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0f, 1f, cycles)); }
                    ts.startFrame = e.flipRandomStart ? new ParticleSystem.MinMaxCurve(0f, (frames - 0.5f) / frames) : new ParticleSystem.MinMaxCurve(0f); // fraction of the sheet, see below
                }
                // Static cells: startFrame as a FRACTION of the sheet (cell / frames, mid-cell). Whole frame numbers drew every
                // cell >= 1 as the last cell (soft-glow cell 1, the wide glow, came out as the ring; feature grid 2026-10-29).
                else { ts.frameOverTime = new ParticleSystem.MinMaxCurve(0f); ts.startFrame = e.flipStartFrame >= 0 ? new ParticleSystem.MinMaxCurve((Mathf.Min(e.flipStartFrame, frames - 1) + 0.5f) / frames) : new ParticleSystem.MinMaxCurve(0f, (frames - 0.5f) / frames); }
            }

            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            r.minParticleSize = 0f; r.maxParticleSize = 5f;
            r.alignment = ParticleSystemRenderSpace.View;
            if (velocity) { r.renderMode = ParticleSystemRenderMode.Stretch; r.velocityScale = 0f; r.lengthScale = Mathf.Max(1f, e.stretchRatio); r.rotateWithStretchDirection = true; }
            else if (e.alignment == "flat") r.renderMode = ParticleSystemRenderMode.HorizontalBillboard; // lying on the ground
            else if (e.alignment == "worldUp") r.renderMode = ParticleSystemRenderMode.VerticalBillboard;
            else r.renderMode = ParticleSystemRenderMode.Billboard;
            r.sortMode = e.blend == "translucent" ? ParticleSystemSortMode.Distance : ParticleSystemSortMode.None;
            if (e.HasTrail)
            {
                // Sparks' trails: Unity's per-particle Trails module. Trail length is a share of the particle's life here.
                var t = e.trail;
                ps.randomSeed = (uint)((string.IsNullOrEmpty(t.seedName) ? e.name : t.seedName).GetHashCode() & 0x7fffffff);
                var tr = ps.trails; tr.enabled = true; tr.mode = ParticleSystemTrailMode.PerParticle; tr.ratio = 1f;
                tr.lifetime = Mathf.Clamp01(t.lifetime / ((lifeMin + lifeMax) / 2f));
                tr.minVertexDistance = 0.02f; tr.dieWithParticles = true; tr.sizeAffectsWidth = false; tr.inheritParticleColor = false;
                tr.textureMode = ParticleSystemTrailTextureMode.Stretch; tr.worldSpace = true;
                tr.widthOverTrail = t.widthKeysT != null && t.widthKeysT.Length > 0 ? new ParticleSystem.MinMaxCurve(t.width, Linear(t.widthKeysT, t.widthKeysV, 1f)) : new ParticleSystem.MinMaxCurve(t.width);
                tr.colorOverTrail = new ParticleSystem.MinMaxGradient(MakeGradient(t.colorKeysT, t.colorKeysRgb, t.alphaKeysT, t.alphaKeysV));
                if (t.trailOnly) r.renderMode = ParticleSystemRenderMode.None;
            }
            return ps;
        }

        /// <summary>The OBJ under Meshes/, baked for this emitter: Y stretched by scaleY and, for velocity-aligned pieces, turned
        /// so the editor's +Y (along travel) becomes Unity's +Z (Velocity alignment points the mesh's forward along travel).</summary>
        static Mesh MeshFor(string folder, VfxEmitterData e)
        {
            var src = $"{folder}/Meshes/{e.mesh.file}";
            AssetDatabase.ImportAsset(src, ImportAssetOptions.ForceSynchronousImport);
            var baseMesh = AssetDatabase.LoadAllAssetsAtPath(src).OfType<Mesh>().FirstOrDefault();
            if (!baseMesh) { Debug.LogWarning($"[VfxStudio] mesh {src} missing: {e.name} draws billboards"); return null; }
            var m = UnityEngine.Object.Instantiate(baseMesh);
            var turn = e.mesh.orientation == "velocity" ? Quaternion.Euler(90f, 0f, 0f) : Quaternion.identity;
            var sy = e.mesh.scaleY > 0f ? e.mesh.scaleY : 1f;
            m.vertices = m.vertices.Select(v => turn * new Vector3(v.x, v.y * sy, v.z)).ToArray();
            m.normals = m.normals.Select(n => (turn * new Vector3(n.x, n.y / sy, n.z)).normalized).ToArray();
            m.RecalculateBounds();
            var path = $"{folder}/Meshes/{Safe(e.name)}_mesh.asset";
            AssetDatabase.DeleteAsset(path); AssetDatabase.CreateAsset(m, path);
            return m;
        }

        /// <summary>Particle-surface material: lit (Standard Surface) or unlit, colour from the particle (colour over life).</summary>
        static Material MeshMaterial(string folder, VfxEmitterData e)
        {
            if (e.blend == "additive") return MakeMaterial(DefaultParticleTexture(), "additive", e.emission);
            // URP needs its own particle shaders (the built-in ones draw magenta there; URP grid column, 2026-10-30).
            var m = new Material(GraphicsSettings.currentRenderPipeline
                ? Shader.Find(e.mesh.lit ? "Universal Render Pipeline/Particles/Lit" : "Universal Render Pipeline/Particles/Unlit")
                : Shader.Find(e.mesh.lit ? "Particles/Standard Surface" : "Particles/Standard Unlit") ?? Shader.Find("Standard"));
            m.SetColor("_BaseColor", Color.white);
            m.color = Color.white;
            if (e.emission > 0f) { m.EnableKeyword("_EMISSION"); m.SetColor("_EmissionColor", Color.white * e.emission * 0.25f); }
            var path = $"{folder}/Materials/{Safe(e.name)}_mesh.mat";
            AssetDatabase.DeleteAsset(path); AssetDatabase.CreateAsset(m, path);
            return m;
        }

        /// <summary>Mesh render mode and the editor's orientations: tumble = random 3D rotation + spin on every axis; velocity =
        /// along travel; upright = random yaw with a lean up to tilt; fixed = +Y along direction.</summary>
        static void SetupMesh(ParticleSystem ps, VfxEmitterData e, Mesh mesh)
        {
            if (!mesh) return;
            var r = ps.GetComponent<ParticleSystemRenderer>();
            r.renderMode = ParticleSystemRenderMode.Mesh; r.mesh = mesh;
            r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            var main = ps.main; main.startRotation3D = true;
            const float TAU = Mathf.PI * 2f;
            switch (e.mesh.orientation)
            {
                case "velocity":
                    r.alignment = ParticleSystemRenderSpace.Velocity;
                    main.startRotationX = main.startRotationY = main.startRotationZ = new ParticleSystem.MinMaxCurve(0f);
                    break;
                case "upright":
                    r.alignment = ParticleSystemRenderSpace.World;
                    main.startRotationX = new ParticleSystem.MinMaxCurve(-e.mesh.tilt, e.mesh.tilt); main.startRotationZ = new ParticleSystem.MinMaxCurve(-e.mesh.tilt, e.mesh.tilt);
                    main.startRotationY = new ParticleSystem.MinMaxCurve(0f, TAU);
                    break;
                case "fixed":
                {
                    r.alignment = ParticleSystemRenderSpace.World;
                    var q = Quaternion.FromToRotation(Vector3.up, VfxEffectData.V(e.mesh.direction).sqrMagnitude > 1e-8f ? VfxEffectData.V(e.mesh.direction).normalized : Vector3.up).eulerAngles * Mathf.Deg2Rad;
                    main.startRotationX = new ParticleSystem.MinMaxCurve(q.x); main.startRotationY = new ParticleSystem.MinMaxCurve(q.y); main.startRotationZ = new ParticleSystem.MinMaxCurve(q.z);
                    break;
                }
                default:
                {
                    r.alignment = ParticleSystemRenderSpace.World;
                    main.startRotationX = main.startRotationY = main.startRotationZ = new ParticleSystem.MinMaxCurve(0f, TAU);
                    if (e.angularVelocityMinDeg != 0f || e.angularVelocityMaxDeg != 0f)
                    {
                        var rot = ps.rotationOverLifetime; rot.enabled = true; rot.separateAxes = true;
                        var w = Range(e.angularVelocityMinDeg * Mathf.Deg2Rad, e.angularVelocityMaxDeg * Mathf.Deg2Rad);
                        rot.x = w; rot.y = w; rot.z = w;
                    }
                    break;
                }
            }
            if (e.mesh.orientation != "tumble") { var rot = ps.rotationOverLifetime; rot.enabled = false; }
        }

        static Light BuildLight(Transform root, VfxLightData l)
        {
            var go = new GameObject(l.name);
            go.transform.SetParent(root, false);
            go.transform.localPosition = VfxEffectData.V(l.position);
            var li = go.AddComponent<Light>();
            li.type = LightType.Point;
            li.color = l.color != null && l.color.Length >= 3 ? new Color(l.color[0], l.color[1], l.color[2]) : Color.white;
            li.range = l.range; li.intensity = 0f; li.shadows = LightShadows.None;
            return li;
        }
    }
}
