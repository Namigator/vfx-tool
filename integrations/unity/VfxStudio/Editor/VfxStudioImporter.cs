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
            Material MaterialFor(string texture, string blend, float emission, VfxEmitterData stretched = null, bool ribbon = false)
            {
                var key = (texture ?? "") + "|" + blend + "|" + emission.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture) + (stretched != null ? "|stretch" : "") + (ribbon ? "|ribbon" : "");
                if (materials.TryGetValue(key, out var m)) return m;
                textures.TryGetValue(texture ?? "", out var tex);
                if (tex && stretched != null) tex = StretchVariant(folder, texture, Mathf.Max(1, stretched.flipColumns), Mathf.Max(1, stretched.flipRows));
                m = MakeMaterial(tex ? tex : ribbon ? DefaultBandTexture() : DefaultParticleTexture(), blend, emission);
                var path = $"{folder}/Materials/{Safe(string.IsNullOrEmpty(texture) ? "default" : Path.GetFileNameWithoutExtension(texture))}_{blend}{(emission > 0f ? "_e" + Mathf.RoundToInt(emission * 100) : "")}{(stretched != null ? "_stretch" : "")}{(ribbon ? "_beam" : "")}.mat";
                AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateAsset(m, path);
                return materials[key] = m;
            }

            var root = new GameObject(Safe(d.name));
            try
            {
                var fx = root.AddComponent<VfxStudioEffect>();
                fx.effectJson = json;
                var systems = new List<ParticleSystem>();
                foreach (var e in d.emitters) systems.Add(BuildEmitter(root.transform, e, d, MaterialFor(e.texture, e.blend, e.emission, e.alignment == "velocity" ? e : null)));
                fx.systems = systems.ToArray();
                fx.lights = d.lights.Select(l => BuildLight(root.transform, l)).ToArray();
                fx.ribbonMaterials = d.ribbons.Select(r => MaterialFor(r.texture, r.additive ? "additive" : "translucent", r.emission, null, true)).ToArray();
                var prefabPath = $"{folder}/{Safe(d.name)}.prefab";
                var prefab = PrefabUtility.SaveAsPrefabAsset(root, prefabPath, out var ok);
                if (!ok) throw new Exception("Could not save " + prefabPath);
                Debug.Log($"{Log}{prefabPath}: {d.emitters.Length} particle systems, {d.lights.Length} lights, {d.ribbons.Length} beam layers, {materials.Count} materials ({(GraphicsSettings.currentRenderPipeline ? "SRP " + GraphicsSettings.currentRenderPipeline.GetType().Name : "built-in pipeline")})");
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

        static Texture2D _band;
        /// <summary>Untextured beams: soft across the strip (V), constant along it (U), like the editor's ribbon falloff.</summary>
        static Texture2D DefaultBandTexture()
        {
            if (_band) return _band;
            const string path = "Assets/VfxStudioEffects/vfxstudio-soft-band.png";
            _band = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (_band) return _band;
            const int n = 64;
            var t = new Texture2D(8, n, TextureFormat.RGBA32, false);
            for (int y = 0; y < n; y++) { float a = 1f - Mathf.SmoothStep(0.35f, 1f, Mathf.Abs((y + .5f) / n - .5f) * 2f); for (int x = 0; x < 8; x++) t.SetPixel(x, y, new Color(1, 1, 1, a)); }
            Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(Application.dataPath), "Assets/VfxStudioEffects"));
            File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(Application.dataPath), path), t.EncodeToPNG());
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            return _band = ImportTexture(path);
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
                m.SetColor("_BaseColor", new Color(boost, boost, boost, 1f));
                m.SetFloat("_Surface", 1f); m.SetFloat("_Blend", additive ? 2f : 0f);
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha); m.SetFloat("_DstBlend", (float)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
                m.SetFloat("_ZWrite", 0f);
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                if (additive) m.EnableKeyword("_ALPHAMODULATE_ON");
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

        static Gradient ColorOverLife(VfxEmitterData e)
        {
            var g = new Gradient();
            GradientColorKey[] ck;
            if (e.colorKeysT != null && e.colorKeysT.Length > 0)
            {
                Color C(int i) => new Color(e.colorKeysRgb[i * 3], e.colorKeysRgb[i * 3 + 1], e.colorKeysRgb[i * 3 + 2]);
                var idx = Pick(e.colorKeysT, i => { var a = C(i - 1); var b = C(i + 1); float u = Mathf.InverseLerp(e.colorKeysT[i - 1], e.colorKeysT[i + 1], e.colorKeysT[i]); var m = Color.Lerp(a, b, u); var c = C(i); return Mathf.Abs(c.r - m.r) + Mathf.Abs(c.g - m.g) + Mathf.Abs(c.b - m.b); });
                ck = idx.Select(i => new GradientColorKey(C(i), e.colorKeysT[i])).ToArray();
            }
            else ck = new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) };
            GradientAlphaKey[] ak;
            if (e.alphaKeysT != null && e.alphaKeysT.Length > 0)
            {
                var idx = Pick(e.alphaKeysT, i => Mathf.Abs(e.alphaKeysV[i] - Mathf.Lerp(e.alphaKeysV[i - 1], e.alphaKeysV[i + 1], Mathf.InverseLerp(e.alphaKeysT[i - 1], e.alphaKeysT[i + 1], e.alphaKeysT[i]))));
                ak = idx.Select(i => new GradientAlphaKey(e.alphaKeysV[i], e.alphaKeysT[i])).ToArray();
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
                    ts.startFrame = e.flipRandomStart ? new ParticleSystem.MinMaxCurve(0f, frames - 1) : new ParticleSystem.MinMaxCurve(0f);
                }
                else { ts.frameOverTime = new ParticleSystem.MinMaxCurve(0f); ts.startFrame = e.flipStartFrame >= 0 ? new ParticleSystem.MinMaxCurve(Mathf.Min(e.flipStartFrame, frames - 1)) : new ParticleSystem.MinMaxCurve(0f, frames - 1); }
            }

            var r = go.GetComponent<ParticleSystemRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = ShadowCastingMode.Off; r.receiveShadows = false;
            r.minParticleSize = 0f; r.maxParticleSize = 5f;
            r.alignment = ParticleSystemRenderSpace.View;
            if (velocity) { r.renderMode = ParticleSystemRenderMode.Stretch; r.velocityScale = 0f; r.lengthScale = Mathf.Max(1f, e.stretchRatio); r.rotateWithStretchDirection = true; }
            else if (e.alignment == "worldUp") r.renderMode = ParticleSystemRenderMode.VerticalBillboard;
            else r.renderMode = ParticleSystemRenderMode.Billboard;
            r.sortMode = e.blend == "translucent" ? ParticleSystemSortMode.Distance : ParticleSystemSortMode.None;
            return ps;
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
