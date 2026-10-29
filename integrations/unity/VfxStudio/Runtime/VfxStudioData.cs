// VFX Studio -> Unity export data (effect.unity.json), read with JsonUtility.
// Mirrors src/export/unity/types.ts in the VFX-Tool repo: metres, seconds, 60 ticks per second, Unity axes
// (Z already mirrored by the exporter), sparse step tracks as parallel tick/value arrays, vectors as float[3].
using System;
using UnityEngine;

namespace VfxStudio
{
    [Serializable]
    public class VfxEmitterData
    {
        public string name;
        public float[] position, direction;
        public string shape; // point | sphere | box | cone | disc
        public float radius, angleDeg;
        public float[] boxSize;
        public int[] rateTicks; public float[] rateValues;
        public int[] burstTicks, burstCounts, burstHasPosition; public float[] burstPositions;
        public float lifetimeMin, lifetimeMax, speedMin, speedMax;
        public float[] acceleration;
        public float drag;
        public bool hasNoise; public float noiseAmplitude, noiseFrequency;
        public bool hasAttract; public float[] attractPosition; public float attractStrength, attractKillRadius;
        public bool hasVortex; public float[] vortexPosition, vortexAxis; public float vortexStrength, vortexInward;
        public bool hasCollision; public float groundY, restitution; public string collisionMode;
        public float sizeMin, sizeMax;
        public float[] sizeKeysT, sizeKeysV, colorKeysT, colorKeysRgb, alphaKeysT, alphaKeysV;
        public float spinMinDeg, spinMaxDeg, angularVelocityMinDeg, angularVelocityMaxDeg;
        public string alignment; // camera | velocity | worldUp | flat (lying on the ground)
        public float stretchRatio;
        public string blend; // additive | translucent | opaque
        public float emission; // colour x (1 + emission)
        public string texture;
        public int flipColumns, flipRows; public float flipFps; public bool flipLoop, flipRandomStart;
        public int flipStartFrame; // static sheets: authored cell, -1 = random per particle
        public bool attachToSource;
        public int[] trackTicks; public float[] trackPositions;
        public VfxTrailData trail; // per-particle trails (sparks); JsonUtility fills an empty one when absent: lifetime 0 = none
        public bool HasTrail => trail != null && trail.lifetime > 0f;
        public VfxMeshData mesh; // mesh particles; empty file = billboards
        public bool HasMesh => mesh != null && !string.IsNullOrEmpty(mesh.file);
    }

    /// <summary>Mesh particles: Meshes/&lt;file&gt; per particle. orientation: tumble | velocity | upright | fixed (+Y along direction).</summary>
    [Serializable]
    public class VfxMeshData
    {
        public string file, orientation;
        public float scaleY, tilt;
        public float[] direction;
        public bool lit;
    }

    /// <summary>Unity Trails module settings. Curves run from the head (0, the particle) to the oldest tail (1).</summary>
    [Serializable]
    public class VfxTrailData
    {
        public float lifetime, width;
        public float[] widthKeysT, widthKeysV, colorKeysT, colorKeysRgb, alphaKeysT, alphaKeysV;
        public string blend, texture, seedName;
        public float emission;
        public bool trailOnly;
    }

    [Serializable]
    public class VfxLightData
    {
        public string name;
        public float[] color;
        public int[] intensityTicks; public float[] intensityValues;
        public float range;
        public float[] position;
        public int[] trackTicks; public float[] trackPositions;
    }

    [Serializable] public class VfxRibbonPath { public float alpha; public float[] points; public int cell; } // x, y, z, width per point; sheet cell
    [Serializable] public class VfxRibbonFrame { public int tick; public VfxRibbonPath[] paths; }
    [Serializable]
    public class VfxRibbonData
    {
        public string name;
        public float[] color;
        public bool additive;
        public float emission;
        public string texture;
        public float endFade;
        // Like the editor (and Godot's vfx_ribbons.gd): textured strips draw ONE cell of a grid[0] x grid[1] sheet per path
        // (paths[].cell), repeated every `tile` metres along the path (0 = stretched once), scrolled by `scroll` UV/s.
        // Untextured strips: `softness` = outer fraction of the half-width that fades out (0 = hard edge).
        public int[] grid;
        public int cell;
        public float tile;
        public float[] scroll;
        public float softness;
        public bool keepHead; // baked particle trails: only the start (old tail) fades, the head stays full
        public VfxRibbonFrame[] frames;
        public int Columns => grid != null && grid.Length > 0 ? Mathf.Max(1, grid[0]) : 1;
        public int Rows => grid != null && grid.Length > 1 ? Mathf.Max(1, grid[1]) : 1;
        public Vector2 Scroll => scroll != null && scroll.Length > 1 ? new Vector2(scroll[0], scroll[1]) : Vector2.zero;
    }

    [Serializable]
    public class VfxEffectData
    {
        public string format;
        public int version;
        public string name;
        public int durationTicks;
        public int ticksPerSecond;
        public float sourceHeight; // origin height above the editor floor (m)
        public VfxEmitterData[] emitters;
        public VfxLightData[] lights;
        public VfxRibbonData[] ribbons;
        public string[] textures;
        public string[] meshes; // OBJ files under Meshes/

        public static VfxEffectData Parse(string json)
        {
            var d = JsonUtility.FromJson<VfxEffectData>(json);
            if (d == null || d.format != "vfx-studio-unity") throw new Exception("Not a VFX Studio Unity export (format must be vfx-studio-unity).");
            if (d.version > 1) Debug.LogWarning($"[VfxStudio] effect version {d.version} is newer than this importer (1); some features may be missing.");
            d.emitters ??= new VfxEmitterData[0]; d.lights ??= new VfxLightData[0]; d.ribbons ??= new VfxRibbonData[0];
            if (d.ticksPerSecond <= 0) d.ticksPerSecond = 60;
            return d;
        }

        public static Vector3 V(float[] a, int i = 0) => a != null && a.Length >= i * 3 + 3 ? new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]) : Vector3.zero;

        /// <summary>Value of a sparse step track at a tick (0 before the first entry).</summary>
        public static float Step(int[] ticks, float[] values, int tick)
        {
            float v = 0f;
            if (ticks == null) return v;
            for (int i = 0; i < ticks.Length && ticks[i] <= tick; i++) v = values[i];
            return v;
        }

        /// <summary>Position along a sparse track at a (fractional) tick, linear between entries, clamped at the ends.</summary>
        public static bool Track(int[] ticks, float[] pos, float tick, out Vector3 p)
        {
            p = Vector3.zero;
            if (ticks == null || ticks.Length == 0) return false;
            if (tick <= ticks[0]) { p = V(pos, 0); return true; }
            for (int i = 1; i < ticks.Length; i++)
                if (tick <= ticks[i]) { p = Vector3.Lerp(V(pos, i - 1), V(pos, i), (tick - ticks[i - 1]) / Mathf.Max(1, ticks[i] - ticks[i - 1])); return true; }
            p = V(pos, ticks.Length - 1);
            return true;
        }
    }
}
