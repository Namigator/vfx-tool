// Plays a VFX Studio effect built by the importer: drives each Particle System's emission rate, bursts and moving
// source tick by tick (60 per second, like the editor), light intensity/position, and baked beam geometry through
// pooled LineRenderers. The Particle Systems keep their own modules (shape, speed, forces, curves over life), so they
// stay editable in the Inspector.
using System.Collections.Generic;
using UnityEngine;

namespace VfxStudio
{
    [DisallowMultipleComponent]
    public class VfxStudioEffect : MonoBehaviour
    {
        [Tooltip("effect.unity.json from the export package.")]
        public TextAsset effectJson;
        [Tooltip("One Particle System per exported emitter, in export order.")]
        public ParticleSystem[] systems = new ParticleSystem[0];
        [Tooltip("One Light per exported light, in export order.")]
        public Light[] lights = new Light[0];
        [Tooltip("Beam materials: per layer (export order) one per sheet cell; ribbonMaterialFirst/Count index into this.")]
        public Material[] ribbonMaterials = new Material[0];
        [HideInInspector] public int[] ribbonMaterialFirst = new int[0];
        [HideInInspector] public int[] ribbonMaterialCount = new int[0];
        public bool playOnEnable = true;
        public bool loop;
        [Min(0f)] public float speed = 1f;

        VfxEffectData _data;
        Vector3[] _homes = new Vector3[0];
        float _time; int _tick = -1; bool _playing;
        List<LineRenderer>[] _pools;
        Transform _ribbonRoot;
        MaterialPropertyBlock _mpb;
        static readonly int MainTexSt = Shader.PropertyToID("_MainTex_ST"), BaseMapSt = Shader.PropertyToID("_BaseMap_ST");

        public VfxEffectData Data => _data ??= effectJson ? VfxEffectData.Parse(effectJson.text) : null;
        public float Duration => Data != null ? Data.durationTicks / (float)Data.ticksPerSecond : 0f;
        public bool IsPlaying => _playing;
        /// <summary>When true (capture tools), nothing advances in Update; call Advance(dt) and the particles are simulated there.</summary>
        public bool ManualSimulation { get; set; }

        void OnEnable() { if (playOnEnable && Application.isPlaying) Play(); }

        public void Play()
        {
            if (Data == null) { Debug.LogWarning("[VfxStudio] no effectJson on " + name); return; }
            if (_homes.Length != systems.Length) { _homes = new Vector3[systems.Length]; for (int i = 0; i < systems.Length; i++) if (systems[i]) _homes[i] = systems[i].transform.localPosition; }
            _time = 0f; _tick = -1; _playing = true;
            foreach (var ps in systems) if (ps) { ps.Clear(true); SetRate(ps, 0f); if (!ManualSimulation) ps.Play(true); }
            foreach (var l in lights) if (l) l.intensity = 0f;
            HideRibbons();
            Apply(0, 0f);
        }

        public void Stop(bool clear = false)
        {
            _playing = false;
            foreach (var ps in systems) if (ps) { SetRate(ps, 0f); if (clear) ps.Clear(true); }
            foreach (var l in lights) if (l) l.intensity = 0f;
            HideRibbons();
        }

        void Update() { if (!ManualSimulation && _playing) Step(Time.deltaTime * speed, false); }

        /// <summary>Advance by dt seconds and simulate the particles by the same amount (ManualSimulation).</summary>
        public void Advance(float dt) { if (_playing || _tick < 0) Step(dt, true); }

        void Step(float dt, bool simulate)
        {
            var d = Data; if (d == null) return;
            float tps = d.ticksPerSecond;
            // Whole ticks are applied one by one so bursts and rate changes land on their tick; particles simulate in tick slices.
            float target = _time + dt;
            while (_playing && Mathf.FloorToInt(target * tps) > _tick)
            {
                int next = _tick + 1;
                float tickTime = next / tps;
                if (simulate && tickTime > _time) { Simulate(tickTime - _time); _time = tickTime; }
                Apply(next, next);
                if (next >= d.durationTicks) { if (loop) { Play(); target -= Duration; } else { _playing = false; foreach (var ps in systems) if (ps) SetRate(ps, 0f); } }
            }
            if (simulate && target > _time) Simulate(target - _time);
            _time = target;
            if (_tick >= 0 && _playing) Move(_time * tps);
        }

        void Simulate(float dt) { foreach (var ps in systems) if (ps) ps.Simulate(dt, false, false, false); }

        static void SetRate(ParticleSystem ps, float rate) { var em = ps.emission; em.rateOverTime = rate; }

        void Apply(int tick, float fractionalTick)
        {
            var d = Data;
            int from = _tick;
            _tick = tick;
            for (int i = 0; i < systems.Length && i < d.emitters.Length; i++)
            {
                var ps = systems[i]; if (!ps) continue;
                var e = d.emitters[i];
                SetRate(ps, VfxEffectData.Step(e.rateTicks, e.rateValues, tick));
                MoveEmitter(i, e, fractionalTick);
                if (e.burstTicks == null) continue;
                for (int b = 0; b < e.burstTicks.Length; b++)
                {
                    if (e.burstTicks[b] <= from || e.burstTicks[b] > tick) continue;
                    var t = ps.transform; var keep = t.localPosition;
                    if (e.burstHasPosition != null && b < e.burstHasPosition.Length && e.burstHasPosition[b] == 1) t.localPosition = VfxEffectData.V(e.burstPositions, b);
                    ps.Emit(e.burstCounts[b]);
                    t.localPosition = keep;
                }
            }
            for (int i = 0; i < lights.Length && i < d.lights.Length; i++)
            {
                if (!lights[i]) continue;
                lights[i].intensity = VfxEffectData.Step(d.lights[i].intensityTicks, d.lights[i].intensityValues, tick);
            }
            Move(fractionalTick);
            DrawRibbons(tick);
        }

        void Move(float tick)
        {
            var d = Data;
            for (int i = 0; i < systems.Length && i < d.emitters.Length; i++) if (systems[i]) MoveEmitter(i, d.emitters[i], tick);
            for (int i = 0; i < lights.Length && i < d.lights.Length; i++)
                if (lights[i] && VfxEffectData.Track(d.lights[i].trackTicks, d.lights[i].trackPositions, tick, out var p)) lights[i].transform.localPosition = p;
        }

        void MoveEmitter(int i, VfxEmitterData e, float tick)
        {
            if (VfxEffectData.Track(e.trackTicks, e.trackPositions, tick, out var p)) systems[i].transform.localPosition = p;
        }

        // ---- beams: one LineRenderer per path, pooled per layer ----
        void HideRibbons() { if (_pools == null) return; foreach (var pool in _pools) foreach (var lr in pool) if (lr) lr.enabled = false; }

        void DrawRibbons(int tick)
        {
            var d = Data;
            if (d.ribbons.Length == 0) return;
            if (_pools == null || _pools.Length != d.ribbons.Length)
            {
                _pools = new List<LineRenderer>[d.ribbons.Length];
                for (int i = 0; i < _pools.Length; i++) _pools[i] = new List<LineRenderer>();
            }
            if (!_ribbonRoot) { var go = transform.Find("Ribbons"); _ribbonRoot = go ? go : new GameObject("Ribbons").transform; _ribbonRoot.SetParent(transform, false); }
            for (int li = 0; li < d.ribbons.Length; li++)
            {
                var layer = d.ribbons[li];
                VfxRibbonFrame frame = null;
                if (layer.frames != null) foreach (var f in layer.frames) { if (f.tick <= tick) frame = f; else break; }
                var pool = _pools[li];
                int used = 0;
                if (frame?.paths != null)
                    foreach (var path in frame.paths)
                    {
                        if (path.points == null || path.points.Length < 8 || path.alpha <= 0f) continue;
                        if (used == pool.Count) pool.Add(NewLine(layer));
                        var lr = pool[used++];
                        lr.sharedMaterial = RibbonMaterial(li, path.cell);
                        Fill(lr, layer, path);
                        UvTransform(lr, layer, tick / (float)d.ticksPerSecond);
                    }
                for (int k = used; k < pool.Count; k++) pool[k].enabled = false;
            }
        }

        /// <summary>The layer's material for a sheet cell (prefabs from older importers: one material per layer).</summary>
        Material RibbonMaterial(int layer, int cell)
        {
            if (ribbonMaterialFirst == null || ribbonMaterialFirst.Length <= layer || ribbonMaterialCount.Length <= layer)
                return layer < ribbonMaterials.Length ? ribbonMaterials[layer] : null;
            int i = ribbonMaterialFirst[layer] + Mathf.Clamp(cell, 0, Mathf.Max(0, ribbonMaterialCount[layer] - 1));
            return i < ribbonMaterials.Length ? ribbonMaterials[i] : null;
        }

        /// <summary>Tiling (u = metres along the path / tile) and UV scroll through the texture transform, per line.</summary>
        void UvTransform(LineRenderer lr, VfxRibbonData layer, float seconds)
        {
            var s = layer.Scroll;
            if (layer.tile <= 0f && s == Vector2.zero) { lr.SetPropertyBlock(null); return; }
            _mpb ??= new MaterialPropertyBlock();
            var st = new Vector4(layer.tile > 0f ? 1f / layer.tile : 1f, 1f, s.x * seconds, s.y * seconds);
            _mpb.SetVector(MainTexSt, st); _mpb.SetVector(BaseMapSt, st);
            lr.SetPropertyBlock(_mpb);
        }

        LineRenderer NewLine(VfxRibbonData layer)
        {
            var go = new GameObject(layer.name);
            go.transform.SetParent(_ribbonRoot, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = false;
            lr.alignment = LineAlignment.View;
            lr.textureMode = layer.tile > 0f ? LineTextureMode.Tile : LineTextureMode.Stretch; // Tile: u = metres along the line
            lr.numCapVertices = 0; lr.numCornerVertices = 1;
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; lr.receiveShadows = false;
            return lr;
        }

        static readonly GradientColorKey[] _ck = new GradientColorKey[2];
        static void Fill(LineRenderer lr, VfxRibbonData layer, VfxRibbonPath path)
        {
            int n = path.points.Length / 4;
            var pts = new Vector3[n];
            var cum = new float[n];
            float maxW = 0f;
            for (int i = 0; i < n; i++)
            {
                pts[i] = new Vector3(path.points[i * 4], path.points[i * 4 + 1], path.points[i * 4 + 2]);
                maxW = Mathf.Max(maxW, path.points[i * 4 + 3]);
                cum[i] = i == 0 ? 0f : cum[i - 1] + Vector3.Distance(pts[i - 1], pts[i]);
            }
            float len = Mathf.Max(1e-5f, cum[n - 1]);
            lr.positionCount = n;
            lr.SetPositions(pts);
            // Width per point (widths already include the export's end taper); keys by distance along the line.
            var keys = new Keyframe[n];
            for (int i = 0; i < n; i++) keys[i] = new Keyframe(cum[i] / len, maxW > 0 ? path.points[i * 4 + 3] / maxW : 0f);
            var curve = new AnimationCurve(keys);
            for (int i = 0; i < n; i++) { curve.SmoothTangents(i, 0f); }
            lr.widthCurve = curve;
            lr.widthMultiplier = maxW;
            var c = new Color(layer.color[0], layer.color[1], layer.color[2]);
            float a = Mathf.Clamp01(path.alpha), fade = Mathf.Clamp(layer.endFade, 0f, 0.5f);
            var g = new Gradient();
            _ck[0] = new GradientColorKey(c, 0f); _ck[1] = new GradientColorKey(c, 1f);
            g.SetKeys(_ck, fade > 0.001f && layer.keepHead
                ? new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(a, fade), new GradientAlphaKey(a, 1f) }
                : fade > 0.001f
                ? new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(a, fade), new GradientAlphaKey(a, 1f - fade), new GradientAlphaKey(0f, 1f) }
                : new[] { new GradientAlphaKey(a, 0f), new GradientAlphaKey(a, 1f) });
            lr.colorGradient = g;
            lr.enabled = true;
        }
    }
}
