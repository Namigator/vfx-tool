// Headless check/capture for VFX Studio prefabs: imports a package, plays it on a fixed 60 Hz clock (particles
// simulated tick by tick through VfxStudioEffect.Advance) and renders chosen ticks to PNG with an auto-framed camera.
// Unity -batchmode -quit -projectPath <p> -executeMethod VfxStudio.EditorTools.VfxStudioCapture.ImportAndCaptureCli
//   -vfxPackage <dir> -vfxOut <dir> [-vfxTicks 30,60,90] [-vfxSize 960x540] [-vfxYaw 0] [-vfxPitch 15] [-vfxZoom 1]
//   or -vfxBatch <file> -vfxOut <dir>: one Unity launch for many packages, one "package|ticks|px,py,pz,tx,ty,tz,fov" per
//   line; a failing package logs "[VfxStudio] ITEM FAILED <package>" and the batch goes on (feature grid, 2026-10-29).
// Run WITHOUT -nographics (rendering needs the GPU). Prints "[VfxStudio] FRAME <path>" and a "[VfxStudio] STATS" line.
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace VfxStudio.EditorTools
{
    public static class VfxStudioCapture
    {
        public static void ImportAndCaptureCli()
        {
            try
            {
                var batch = VfxStudioImporter.Arg("-vfxBatch");
                if (batch != null) { CaptureBatch(batch); EditorApplication.Exit(0); return; }
                var prefab = VfxStudioImporter.Import(VfxStudioImporter.ToAssetFolder(VfxStudioImporter.Arg("-vfxPackage") ?? throw new ArgumentException("-vfxPackage required")));
                var outDir = VfxStudioImporter.Arg("-vfxOut") ?? Path.Combine(Path.GetDirectoryName(Application.dataPath), "VfxCaptures");
                var ticks = (VfxStudioImporter.Arg("-vfxTicks") ?? "30,60,90").Split(',').Select(s => int.Parse(s.Trim())).OrderBy(x => x).ToArray();
                var size = (VfxStudioImporter.Arg("-vfxSize") ?? "960x540").Split('x').Select(int.Parse).ToArray();
                float yaw = float.Parse(VfxStudioImporter.Arg("-vfxYaw") ?? "0"), pitch = float.Parse(VfxStudioImporter.Arg("-vfxPitch") ?? "15"), zoom = float.Parse(VfxStudioImporter.Arg("-vfxZoom") ?? "1");
                // -vfxPlay: the frames come from real Play mode (Update + Time.deltaTime), launched WITHOUT -quit; it exits itself.
                bool play = Environment.GetCommandLineArgs().Contains("-vfxPlay");
                Capture(prefab, outDir, ticks, size[0], size[1], yaw, pitch, zoom, VfxStudioImporter.Arg("-vfxCam"), play);
                if (!play) EditorApplication.Exit(0);
            }
            catch (Exception ex) { Debug.LogError("[VfxStudio] CAPTURE FAILED " + ex); EditorApplication.Exit(1); }
        }

        static void CaptureBatch(string file)
        {
            var outDir = VfxStudioImporter.Arg("-vfxOut") ?? Path.Combine(Path.GetDirectoryName(Application.dataPath), "VfxCaptures");
            foreach (var line in File.ReadAllLines(file).Where(l => l.Trim().Length > 0))
            {
                var f = line.Split('|');
                try
                {
                    var prefab = VfxStudioImporter.Import(VfxStudioImporter.ToAssetFolder(f[0]));
                    var ticks = f[1].Split(',').Select(s => int.Parse(s.Trim())).OrderBy(x => x).ToArray();
                    Capture(prefab, outDir, ticks, 960, 540, 0f, 15f, 1f, f.Length > 2 ? f[2] : null);
                }
                catch (Exception ex) { Debug.LogError($"[VfxStudio] ITEM FAILED {f[0]} {ex.Message}"); }
            }
        }

        public static void Capture(GameObject prefab, string outDir, int[] ticks, int width, int height, float yaw, float pitch, float zoom = 1f, string camArg = null, bool play = false)
        {
            Directory.CreateDirectory(outDir);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            // The editor's stage light: AmbientLight 0.6 + HemisphereLight (sky #bfd0ff, ground #3a3128) 0.8, as a trilight
            // ambient in linear values (lit mesh particles were near-black under the former dim flat ambient). No sky reflections.
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
            Color L(float r, float g, float b) => new Color(Mathf.LinearToGammaSpace(r), Mathf.LinearToGammaSpace(g), Mathf.LinearToGammaSpace(b));
            RenderSettings.ambientSkyColor = L(1.02f, 1.10f, 1.40f); RenderSettings.ambientEquatorColor = L(0.82f, 0.86f, 1.01f); RenderSettings.ambientGroundColor = L(0.63f, 0.62f, 0.62f);
            RenderSettings.defaultReflectionMode = UnityEngine.Rendering.DefaultReflectionMode.Custom;
            RenderSettings.skybox = null;
            var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
            floor.transform.localScale = new Vector3(4f, 1f, 4f);
            floor.transform.position = new Vector3(0f, -0.01f, 0f); // just under ground-level rings
            var floorMat = new Material(UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline ? Shader.Find("Universal Render Pipeline/Lit") : Shader.Find("Standard")); // Standard draws magenta under URP
            floorMat.color = new Color(0.063f, 0.075f, 0.102f); // the editor's ground, 0x10131a
            floorMat.SetFloat("_Glossiness", 0f); floorMat.SetFloat("_Smoothness", 0f);
            floor.GetComponent<Renderer>().sharedMaterial = floorMat;

            var inst = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            var fx = inst.GetComponent<VfxStudioEffect>();
            fx.ManualSimulation = true;
            // The prefab origin is the Source anchor: stand it at its authored height above the floor.
            inst.transform.position = new Vector3(0f, fx.Data.sourceHeight > 0f ? fx.Data.sourceHeight : 1.2f, 0f);
            int last = ticks.Max();

            // Pass 1: bounds of everything that draws, over the captured ticks.
            var b = new Bounds(inst.transform.position, Vector3.one * 0.5f);
            int peak = 0, totalBeams = 0;
            fx.Play();
            var buf = new ParticleSystem.Particle[100000];
            for (int t = 1; t <= last; t++)
            {
                fx.Advance(1f / 60f);
                int alive = 0;
                foreach (var ps in fx.systems)
                {
                    int n = ps.GetParticles(buf); alive += n;
                    var space = ps.main.simulationSpace;
                    for (int i = 0; i < n; i++) { var p = space == ParticleSystemSimulationSpace.World ? buf[i].position : ps.transform.TransformPoint(buf[i].position); if (ticks.Contains(t)) b.Encapsulate(p); }
                }
                peak = Mathf.Max(peak, alive);
                var lines = inst.GetComponentsInChildren<LineRenderer>().Where(l => l.enabled).ToArray();
                totalBeams = Mathf.Max(totalBeams, lines.Length);
                if (ticks.Contains(t)) foreach (var l in lines) for (int i = 0; i < l.positionCount; i++) b.Encapsulate(l.transform.TransformPoint(l.GetPosition(i)));
            }
            Debug.Log($"[VfxStudio] STATS peakParticles={peak} peakBeams={totalBeams} bounds={b.center}/{b.size}");
            foreach (var ps in fx.systems)
            {
                int n = ps.GetParticles(buf);
                var r = ps.GetComponent<ParticleSystemRenderer>();
                Debug.Log($"[VfxStudio] SYS {ps.name} alive={n} mode={r.renderMode} len={r.lengthScale} rot={(n > 0 ? buf[0].rotation : 0f)} vel={(n > 0 ? buf[0].velocity.ToString("F2") : "-")} animVel={(n > 0 ? buf[0].animatedVelocity.ToString("F2") : "-")} total={(n > 0 ? buf[0].totalVelocity.ToString("F2") : "-")}");
            }

            // Pass 2: replay from the start (fixed seeds) and render.
            var cam = new GameObject("Camera").AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor; cam.backgroundColor = new Color(0.03f, 0.03f, 0.045f);
            cam.fieldOfView = 40f; cam.nearClipPlane = 0.05f; cam.farClipPlane = 500f; cam.allowHDR = true;
            float radius = Mathf.Max(0.5f, b.extents.magnitude);
            float dist = radius / Mathf.Sin(cam.fieldOfView * 0.5f * Mathf.Deg2Rad) * 0.9f / Mathf.Max(0.1f, zoom);
            // VFX Studio's default view looks from +Z; Unity's Z is mirrored, so the same view is from -Z.
            var look = Quaternion.Euler(pitch, yaw, 0f);
            cam.transform.position = b.center + look * new Vector3(0f, 0f, -dist);
            cam.transform.rotation = look;
            // Optional fixed camera "px,py,pz,tx,ty,tz,fov" in Unity world metres (floor at y=0, Source anchor above the
            // origin) to match a VFX Studio view: tool point (x,y,z) -> (x - sourceX, y, -(z - sourceZ)); fov vertical.
            if (camArg != null)
            {
                var c = camArg.Split(',').Select(s => float.Parse(s, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                cam.transform.position = new Vector3(c[0], c[1], c[2]);
                cam.transform.LookAt(new Vector3(c[3], c[4], c[5]));
                cam.fieldOfView = c[6];
            }
            var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
            cam.targetTexture = rt;
            var img = new Texture2D(width, height, TextureFormat.RGB24, false);

            fx.flashCamera = cam;
            if (play) { PlayModeCapture.Begin(fx, cam, rt, img, ticks, outDir, prefab.name); return; }
            fx.Play();
            for (int t = 1; t <= last; t++)
            {
                fx.Advance(1f / 60f);
                if (!ticks.Contains(t)) continue;
                cam.Render();
                RenderTexture.active = rt;
                img.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                img.Apply();
                RenderTexture.active = null;
                var file = Path.Combine(outDir, $"{prefab.name}-t{t}.png");
                File.WriteAllBytes(file, img.EncodeToPNG());
                Debug.Log("[VfxStudio] FRAME " + file);
            }
            cam.targetTexture = null;
            UnityEngine.Object.DestroyImmediate(rt);
        }

        /// <summary>Real Play mode: scene and domain reload off (the built scene stays), Time.captureFramerate 60 so each
        /// player frame is one 1/60 s step, the effect advancing in its own Update and the Particle Systems playing on
        /// their own clock, as in a game. Renders when the effect reaches each tick ("PLAYFRAME ... tick N").</summary>
        static class PlayModeCapture
        {
            static VfxStudioEffect _fx; static Camera _cam; static RenderTexture _rt; static Texture2D _img;
            static int[] _ticks; static string _out, _name; static bool _started; static int _next, _idle;

            public static void Begin(VfxStudioEffect fx, Camera cam, RenderTexture rt, Texture2D img, int[] ticks, string outDir, string name)
            {
                _fx = fx; _cam = cam; _rt = rt; _img = img; _ticks = ticks; _out = outDir; _name = name; _started = false; _next = 0; _idle = 0;
                fx.ManualSimulation = false; fx.playOnEnable = false;
                EditorSettings.enterPlayModeOptionsEnabled = true;
                EditorSettings.enterPlayModeOptions = EnterPlayModeOptions.DisableDomainReload | EnterPlayModeOptions.DisableSceneReload;
                EditorApplication.update += Update;
                EditorApplication.isPlaying = true;
            }

            static void Update()
            {
                try
                {
                    if (++_idle > 20000) throw new Exception("play mode made no progress");
                    if (!EditorApplication.isPlaying || !_fx) return;
                    if (!_started) { Time.captureFramerate = 60; _fx.Play(); _started = true; return; }
                    while (_next < _ticks.Length && _fx.Tick >= _ticks[_next])
                    {
                        _cam.Render();
                        RenderTexture.active = _rt;
                        _img.ReadPixels(new Rect(0, 0, _rt.width, _rt.height), 0, 0);
                        _img.Apply();
                        RenderTexture.active = null;
                        var file = Path.Combine(_out, $"{_name}-t{_ticks[_next]}.png");
                        File.WriteAllBytes(file, _img.EncodeToPNG());
                        Debug.Log($"[VfxStudio] PLAYFRAME {file} tick {_fx.Tick} frame {Time.frameCount}");
                        _next++;
                    }
                    if (_next >= _ticks.Length) { EditorApplication.update -= Update; EditorApplication.Exit(0); }
                }
                catch (Exception ex) { Debug.LogError("[VfxStudio] CAPTURE FAILED " + ex); EditorApplication.update -= Update; EditorApplication.Exit(1); }
            }
        }
    }
}
