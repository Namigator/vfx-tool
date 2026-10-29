# Offline capture of an imported VFX Studio NiagaraSystem through Movie Render Queue (run by tools/unreal-check.mjs
# when VFX_UE_CAPTURE=mrq). Same env and output as tools/unreal-capture.py: VFX_NS, VFX_OUT, VFX_SECONDS, VFX_CAM_*,
# VFX_FOV, VFX_ACTOR_Z; writes <VFX_OUT>/unreal_capture (PNG) and quits the editor.
# Why: the live SceneCapture2D path raced the editor's frame rate and shader compiles (the same effect came out blank
# in one run and fine in the next, 2026-10-28). MRQ renders on a fixed 1/60 s step, blocks on shader compilation every
# frame, and a Niagara life-cycle track seeks the system to its exact age, so window focus and load do not matter.
# Needs the MovieRenderPipeline + SequencerScripting plugins enabled in the test project.
import os
import shutil
import unreal

NS_PATH = os.environ.get("VFX_NS", "/Game/VFXStudio/flamethrower/NS_flamethrower")
OUT_DIR = os.environ.get("VFX_OUT", "C:/temp")
SECONDS = float(os.environ.get("VFX_SECONDS", "1.0"))
W, H = 960, 540
FPS = 60
FRAMES = max(1, int(round(SECONDS * FPS)))
CAP_ROOT = "/Game/VFXCap"
MAP_PATH = CAP_ROOT + "/Map_cap"
FRAME_DIR = os.path.join(OUT_DIR, "mrq")

el = unreal.EditorLevelLibrary
tools = unreal.AssetToolsHelpers.get_asset_tools()
vec = lambda s: unreal.Vector(*[float(v) for v in s.split(",")])


def log(*a):
    print("VFXCAP", *a)


def quit_editor():
    unreal.SystemLibrary.quit_editor()


# --- Scene: identical to unreal-capture.py so both paths frame the same shot. Saved as a map: MRQ renders a map asset.
for p in (MAP_PATH, CAP_ROOT + "/LS_cap"):
    if unreal.EditorAssetLibrary.does_asset_exist(p):
        unreal.EditorAssetLibrary.delete_asset(p)
unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
el.spawn_actor_from_class(unreal.DirectionalLight, unreal.Vector(0, 0, 500), unreal.Rotator(-40, -30, 0))
el.spawn_actor_from_class(unreal.SkyLight, unreal.Vector(0, 0, 300), unreal.Rotator(0, 0, 0))
# VFX_LOOK=editor: the VFX Studio editor's stage, for side-by-sides (as tools/build-godot-compare.mjs does for Godot):
# its dark 16 x 10 m ground at VFX_FLOOR_Z under the camera's look-at, no reference cube, and its post (below).
EDITOR_LOOK = os.environ.get("VFX_LOOK") == "editor"
if not EDITOR_LOOK:
    ref = el.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 250, 0), unreal.Rotator(0, 0, 0))
    ref.static_mesh_component.set_static_mesh(unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube"))
    ref.set_actor_scale3d(unreal.Vector(0.4, 0.4, 0.4))
floor = el.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(250, 0, -10), unreal.Rotator(0, 0, 0))
floor.static_mesh_component.set_static_mesh(unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Plane.Plane"))
floor.set_actor_scale3d(unreal.Vector(12, 8, 1))
if EDITOR_LOOK:
    look_x = float(os.environ["VFX_CAM_LOOK"].split(",")[0]) if os.environ.get("VFX_CAM_LOOK") else 0.0
    floor.set_actor_location(unreal.Vector(look_x, 0, float(os.environ.get("VFX_FLOOR_Z", "0"))), False, False)
    floor.set_actor_scale3d(unreal.Vector(16, 10, 1))
    # The editor's ground colour 0x10131a (linear ~0.005, 0.007, 0.010) on the stock shape material.
    mi_path = CAP_ROOT + "/MI_floor"
    if unreal.EditorAssetLibrary.does_asset_exist(mi_path):
        unreal.EditorAssetLibrary.delete_asset(mi_path)
    mi = tools.create_asset("MI_floor", CAP_ROOT, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    unreal.MaterialEditingLibrary.set_material_instance_parent(mi, unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial"))
    unreal.MaterialEditingLibrary.set_material_instance_vector_parameter_value(mi, "Color", unreal.LinearColor(0.0052, 0.0065, 0.0103, 1))
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    floor.static_mesh_component.set_material(0, mi)

ns = unreal.EditorAssetLibrary.load_asset(NS_PATH)
log("asset", NS_PATH, bool(ns))
actor = el.spawn_actor_from_class(unreal.NiagaraActor, unreal.Vector(0, 0, float(os.environ.get("VFX_ACTOR_Z", "120"))), unreal.Rotator(0, 0, 0))
comp = actor.niagara_component
comp.set_asset(ns)
comp.set_auto_activate(False)  # the sequence's life-cycle track activates it on frame 0
if os.environ.get("VFX_DUMP_SYSTEM"):  # diagnostic: log system + emitter execution state every system tick
    unreal.SystemLibrary.execute_console_command(None, "fx.DumpSystemData 1"); unreal.SystemLibrary.execute_console_command(None, "fx.DumpParticleData 1")
    log("fx.DumpSystemData 1")
if os.environ.get("VFX_FIXED_BOUNDS"):  # diagnostic: rule out bounds culling with a huge fixed box (cm)
    r = float(os.environ["VFX_FIXED_BOUNDS"])
    comp.set_system_fixed_bounds(unreal.Box(unreal.Vector(-r, -r, -r), unreal.Vector(r, r, r)))
    log("fixed bounds", r)

CAM_X = float(os.environ.get("VFX_CAM_X", "220"))
CAM_DIST = float(os.environ.get("VFX_CAM_DIST", "620"))
cam_pos = vec(os.environ["VFX_CAM_POS"]) if os.environ.get("VFX_CAM_POS") else unreal.Vector(CAM_X, -CAM_DIST, 200)
cam_look = vec(os.environ["VFX_CAM_LOOK"]) if os.environ.get("VFX_CAM_LOOK") else unreal.Vector(CAM_X, 0, 110)
cam = el.spawn_actor_from_class(unreal.CineCameraActor, cam_pos, (cam_look - cam_pos).rotator())
cc = cam.get_cine_camera_component()
# Horizontal FOV -> focal length on a 16:9 filmback (keeps the SceneCapture path's VFX_FOV meaning).
import math
fb = cc.get_editor_property("filmback")
fb.set_editor_property("sensor_width", 23.76)
fb.set_editor_property("sensor_height", 13.365)
cc.set_editor_property("filmback", fb)
cc.set_editor_property("current_focal_length", (23.76 / 2) / math.tan(math.radians(float(os.environ.get("VFX_FOV", "60")) / 2)))
fs = cc.get_editor_property("focus_settings")
fs.set_editor_property("focus_method", unreal.CameraFocusMethod.DISABLE)
cc.set_editor_property("focus_settings", fs)
# Fixed exposure 1.0, as the SceneCapture2D path renders (it has no eye adaptation): auto-exposure on this dark,
# sky-less map blew the frame to white and washed out additive particles.
pp = cc.get_editor_property("post_process_settings")
for k, v in (("auto_exposure_method", unreal.AutoExposureMethod.AEM_HISTOGRAM), ("auto_exposure_min_brightness", 1.0),
             ("auto_exposure_max_brightness", 1.0), ("auto_exposure_bias", 0.0), ("auto_exposure_apply_physical_camera_exposure", False)):
    pp.set_editor_property("override_" + k, True)
    pp.set_editor_property(k, v)
if EDITOR_LOOK:
    # The editor's post (PreviewViewport): three's ACES (exposure 1/0.6) + UnrealBloom strength 0.8, radius 0.45,
    # threshold 1, five blurred mips of sigma ~6/20/56/144/352 px at 1280 wide, each weighted ~0.48 (sum 2.4).
    # Unreal's filmic curve is its ACES fit; bloom sizes are % of screen width. VFX_BLOOM scales the intensity.
    post = [("auto_exposure_bias", math.log2(1 / 0.6)), ("bloom_method", unreal.BloomMethod.BM_SOG),
            ("bloom_intensity", float(os.environ.get("VFX_BLOOM", "1.0"))), ("bloom_threshold", 1.0), ("bloom_size_scale", 1.0)]
    for i, (size, w) in enumerate([(1.0, 0.51), (3.0, 0.50), (9.0, 0.48), (22.0, 0.46), (55.0, 0.45), (64.0, 0.0)]):
        post += [("bloom%d_size" % (i + 1), size), ("bloom%d_tint" % (i + 1), unreal.LinearColor(w, w, w, 1))]
    for k, v in post:
        pp.set_editor_property("override_" + k, True)
        pp.set_editor_property(k, v)
cc.set_editor_property("post_process_settings", pp)

world = el.get_editor_world()
unreal.EditorLoadingAndSavingUtils.save_map(world, MAP_PATH)
log("map saved", MAP_PATH)

# --- Sequence: camera cut on the cine camera + Niagara life-cycle track that seeks the system to its age each frame.
ls = tools.create_asset("LS_cap", CAP_ROOT, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
ls.set_display_rate(unreal.FrameRate(FPS, 1))
ls.set_playback_start(0)
ls.set_playback_end(FRAMES + 1)
add_track = ls.add_track if hasattr(ls, "add_track") else ls.add_master_track
cam_b = ls.add_possessable(cam)
cut = add_track(unreal.MovieSceneCameraCutTrack)
cut_sec = cut.add_section()
cut_sec.set_range(0, FRAMES + 1)
cut_sec.set_camera_binding_id(ls.get_binding_id(cam_b))
nia_b = ls.add_possessable(comp)
nia_t = nia_b.add_track(unreal.MovieSceneNiagaraSystemTrack)
nia_s = nia_t.add_section()
nia_s.set_range(0, FRAMES + 1)
try:
    nia_s.set_age_update_mode(unreal.NiagaraAgeUpdateMode.DESIRED_AGE)
except Exception as e:
    log("age mode n/a", e)
nia_s.set_section_end_behavior(unreal.NiagaraSystemSpawnSectionEndBehavior.NONE)
unreal.EditorAssetLibrary.save_loaded_asset(ls)
log("sequence", ls.get_path_name(), "frames", FRAMES)

# --- Render job. No warm-up: warm-up frames tick the world and would age the effect before frame 0.
shutil.rmtree(FRAME_DIR, ignore_errors=True)
subsys = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem)
queue = subsys.get_queue()
queue.delete_all_jobs()
job = queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
job.map = unreal.SoftObjectPath(MAP_PATH + ".Map_cap")
job.sequence = unreal.SoftObjectPath(ls.get_path_name())
cfg = job.get_configuration()
out = cfg.find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
out.output_directory = unreal.DirectoryPath(FRAME_DIR)
out.output_resolution = unreal.IntPoint(W, H)
out.file_name_format = "f.{frame_number}"
out.zero_pad_frame_numbers = 4
out.override_existing_output = True
cfg.find_or_add_setting_by_class(unreal.MoviePipelineDeferredPassBase)
png = cfg.find_or_add_setting_by_class(unreal.MoviePipelineImageSequenceOutput_PNG)
png.write_alpha = False  # the empty background and additive particles have alpha 0: viewers showed them as white
aa = cfg.find_or_add_setting_by_class(unreal.MoviePipelineAntiAliasingSetting)
aa.override_anti_aliasing = True
aa.anti_aliasing_method = unreal.AntiAliasingMethod.AAM_NONE
aa.spatial_sample_count = 1
aa.temporal_sample_count = 1
aa.engine_warm_up_count = 0
aa.render_warm_up_count = 0
aa.use_camera_cut_for_warm_up = False
out.use_custom_playback_range = True
# Render every frame from 0, ticking like real play. Seeking straight to the last frame (VFX_SEEK=1) leaves the
# component's visibility bounds stale after the jump: Bolt's impact flash, glow and sparks were alive at t72 but not
# drawn (2026-10-29, work/unreal/bisP-frames.png).
out.custom_start_frame = FRAMES if os.environ.get("VFX_SEEK") else 0
out.custom_end_frame = FRAMES + 1

state = {}


def on_finished(executor, success):
    pngs = sorted(f for f in os.listdir(FRAME_DIR) if f.endswith(".png")) if os.path.isdir(FRAME_DIR) else []
    log("mrq finished ok", success, "frames", pngs)
    if pngs:
        shutil.copyfile(os.path.join(FRAME_DIR, pngs[-1]), os.path.join(OUT_DIR, "unreal_capture"))
        log("exported", OUT_DIR, "unreal_capture from", pngs[-1])
    quit_editor()


def on_error(executor, pipeline, fatal, message):
    log("mrq ERROR", fatal, message)


executor = subsys.render_queue_with_executor(unreal.MoviePipelinePIEExecutor)
state["executor"] = executor  # keep the delegates' owner alive
executor.on_executor_finished_delegate.add_callable_unique(on_finished)
executor.on_executor_errored_delegate.add_callable_unique(on_error)
log("mrq render started", FRAMES, "frames @", FPS)
