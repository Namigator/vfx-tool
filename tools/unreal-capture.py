# In-editor capture of an imported VFX Studio NiagaraSystem (run by tools/unreal-check.mjs):
#   UnrealEditor.exe <project> -RenderOffscreen -unattended -nosplash -ExecutePythonScript=<this file>
# with env VFX_NS (asset path of the NiagaraSystem), VFX_OUT (output folder), VFX_SECONDS (simulated time, default 1.0).
# A -game launch screenshots its very first frame (black: nothing compiled or simulated yet). Here the editor keeps
# running, a post-tick callback waits for shaders to finish compiling, steps the simulation, captures through a
# SceneCapture2D into a render target, exports it as an image and quits the editor.
import os
import time
import unreal

NS_PATH = os.environ.get("VFX_NS", "/Game/VFXStudio/flamethrower/NS_flamethrower")
OUT_DIR = os.environ.get("VFX_OUT", "C:/temp")
SECONDS = float(os.environ.get("VFX_SECONDS", "1.0"))
W, H = 960, 540

unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
world = unreal.EditorLevelLibrary.get_editor_world()
el = unreal.EditorLevelLibrary

# Reference geometry + light so a blank frame can be told apart from a broken capture.
sun = el.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 500), unreal.Rotator(-40, -30, 0))
sky = el.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 300), unreal.Rotator(0, 0, 0))
ref = el.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 250, 0), unreal.Rotator(0, 0, 0))
ref.static_mesh_component.set_static_mesh(unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube"))
ref.set_actor_scale3d(unreal.Vector(0.4, 0.4, 0.4))
floor = el.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(250, 0, -10), unreal.Rotator(0, 0, 0))
floor.static_mesh_component.set_static_mesh(unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane.Plane"))
floor.set_actor_scale3d(unreal.Vector(12, 8, 1))
ns = unreal.EditorAssetLibrary.load_asset(NS_PATH)
print("VFXCAP asset", NS_PATH, bool(ns))
actor = el.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(0, 0, 0), unreal.Rotator(0, 0, 0))
actor.set_actor_location(unreal.Vector(0, 0, 0), False, False)
comp = actor.niagara_component
comp.set_asset(ns)
try:
    comp.set_force_solo(True)
except Exception as e:
    print("VFXCAP force_solo n/a", e)
print("VFXCAP actor at", actor.get_actor_location(), "asset", comp.get_asset())

# Camera: look at the effect from the side (Unreal: X forward, Y right, Z up; VFX Studio Source->Target runs along +X).
cap_actor = el.spawn_actor_from_class(unreal.SceneCapture2D, unreal.Vector(220, -620, 200), unreal.Rotator(0, 0, 0))
cap_actor.set_actor_rotation((unreal.Vector(220, 0, 110) - cap_actor.get_actor_location()).rotator(), False)
cap = cap_actor.capture_component2d
rt = unreal.RenderingLibrary.create_render_target2d(world, W, H, unreal.TextureRenderTargetFormat.RTF_RGBA8, unreal.LinearColor(0, 0, 0, 1))
cap.set_editor_property("texture_target", rt)
cap.set_editor_property("capture_every_frame", False)
cap.set_editor_property("capture_on_movement", False)
cap.set_editor_property("capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR)
cap.set_editor_property("fov_angle", 60.0)

state = {"frames": 0, "start": time.time(), "phase": "compile", "handle": None}

def shaders_pending():
    try:
        return unreal.ShaderCompilingLibrary.get_num_remaining_jobs() if hasattr(unreal, "ShaderCompilingLibrary") else 0
    except Exception:
        return 0

def on_tick(dt):
    state["frames"] += 1
    elapsed = time.time() - state["start"]
    if state["phase"] == "compile":
        # Let materials/Niagara scripts compile: at least 120 editor ticks and 20 s, at most 240 s.
        if (state["frames"] >= 120 and elapsed >= 20 and shaders_pending() == 0) or elapsed > 240:
            comp.reinitialize_system()
            comp.activate(True)
            print("VFXCAP after activate", comp.is_active())
            comp.advance_simulation(max(1, int(SECONDS * 60)), 1.0 / 60.0)
            print("VFXCAP active", comp.is_active(), "after", round(elapsed, 1), "s")
            state["phase"] = "render"; state["frames"] = 0
        return
    if state["phase"] == "render":
        if state["frames"] in (1, 5, 20):
            print("VFXCAP tick", state["frames"], "active", comp.is_active())
        if state["frames"] < int(os.environ.get("VFX_RENDER_TICKS", "10")):
            return  # a few ticks so the renderer picks up the simulated particles
        cap.capture_scene()
        state["phase"] = "export"; state["frames"] = 0
        return
    if state["phase"] == "export" and state["frames"] >= 3:
        name = "unreal_capture"
        unreal.RenderingLibrary.export_render_target(world, rt, OUT_DIR, name)
        print("VFXCAP exported", OUT_DIR, name, "after", round(elapsed, 1), "s")
        state["phase"] = "done"
        unreal.unregister_slate_post_tick_callback(state["handle"])
        unreal.SystemLibrary.quit_editor()

state["handle"] = unreal.register_slate_post_tick_callback(on_tick)
print("VFXCAP waiting for shaders, then simulating", SECONDS, "s")
