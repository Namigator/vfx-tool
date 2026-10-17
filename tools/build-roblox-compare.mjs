// Builds a Roblox place that shows exported effects frozen at chosen ticks from a fixed camera, for side-by-side
// comparison with the tool's renders (vfx_render_frames with the same camera). In Play mode a client script plays each
// effect, freezes it at each tick (particles TimeScale 0, trails held), labels the screen "<n> <effect> t<tick>" and
// holds HOLD seconds, then moves on; capture the Studio window every HOLD seconds.
//
//   node tools/build-roblox-compare.mjs <outDir> <spec.json>
// spec.json: [{ "name": "ArcaneBolt", "rbxmx": "path.rbxmx", "doc": "path.json", "ticks": [40,72,80],
//              "camera": { "position": [x,y,z], "target": [x,y,z], "fov": 50 } }, ...]   (camera in tool metres)
// Prints the cameras so the same views can be rendered in the tool. The effect origin (model pivot) sits at the floor
// point under the Source anchor, exactly as the exporter places it, so tool metres map to studs as (p - origin) * 3.571.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [outDir, specPath] = process.argv.slice(2);
if (!outDir || !specPath) { console.error('usage: build-roblox-compare.mjs <outDir> <spec.json>'); process.exit(2); }
const out = resolve(outDir), S = 3.571, HOLD = 2;
mkdirSync(join(out, 'effects'), { recursive: true });
mkdirSync(join(out, 'src'), { recursive: true });
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const frames = [];
spec.forEach((e, i) => {
  copyFileSync(e.rbxmx, join(out, 'effects', `${e.name}.rbxmx`));
  const doc = JSON.parse(readFileSync(e.doc, 'utf8'));
  const src = doc.anchors.find(a => a.id === 'source').position, origin = [src[0], 0, src[2]];
  const studs = p => p.map((v, k) => Number(((v - origin[k]) * S).toFixed(3)));
  for (const t of e.ticks) frames.push({ n: frames.length + 1, effect: e.name, tick: t, pos: studs(e.camera.position), target: studs(e.camera.target), fov: e.camera.fov ?? 50 });
  console.log(`${i + 1}. ${e.name}: camera ${JSON.stringify(e.camera)} ticks ${e.ticks.join(',')}`);
});
writeFileSync(join(out, 'schedule.txt'), JSON.stringify({ hold: HOLD, frames }));
writeFileSync(join(out, 'src', 'Compare.client.lua'), String.raw`-- Plays each scheduled effect, freezes it at the scheduled tick and labels the frame (see tools/build-roblox-compare.mjs).
local RS = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local HttpService = game:GetService("HttpService")
local spec = HttpService:JSONDecode(RS:WaitForChild("Schedule").Value)
local effects = RS:WaitForChild("Effects")
local cam = workspace.CurrentCamera
local gui = Instance.new("ScreenGui")
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
local label = Instance.new("TextLabel")
label.Size = UDim2.fromOffset(420, 36)
label.Position = UDim2.fromOffset(10, 10)
label.BackgroundColor3 = Color3.new(0, 0, 0)
label.BackgroundTransparency = 0.2
label.TextColor3 = Color3.new(1, 1, 0.4)
label.Font = Enum.Font.Code
label.TextSize = 24
label.Text = "starting"
label.Parent = gui
gui.Parent = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui")
task.wait(3)
for _, f in ipairs(spec.frames) do
	cam.CameraType = Enum.CameraType.Scriptable
	cam.FieldOfView = f.fov
	cam.CFrame = CFrame.lookAt(Vector3.new(f.pos[1], f.pos[2], f.pos[3]), Vector3.new(f.target[1], f.target[2], f.target[3]))
	local model = effects:FindFirstChild(f.effect):Clone()
	model:PivotTo(CFrame.new())
	model.Parent = workspace
	local Player = require(model:FindFirstChild("EffectPlayer"))
	local p = Player.create(model, CFrame.new(), {})
	-- Slow motion (not a freeze: trails and beams keep behaving normally): the whole effect runs at SLOW speed.
	local SLOW = 0.1
	for _, d in ipairs(model:GetDescendants()) do
		if d:IsA("ParticleEmitter") then d.TimeScale = SLOW elseif d:IsA("Trail") then d.Lifetime /= SLOW end
	end
	label.Text = string.format("%d %s t%d ...", f.n, f.effect, f.tick)
	local t = 0
	local function step()
		local dt = math.min(RunService.RenderStepped:Wait(), 1 / 30) * SLOW
		p.update(dt)
		t += dt
	end
	while t < f.tick / 60 do step() end
	label.Text = string.format("%d %s t%d", f.n, f.effect, f.tick)
	print("COMPARE_FROZEN", f.n, f.effect, f.tick)
	local held = 0
	while held < spec.hold do local t0 = t; step(); held += (t - t0) / SLOW end
	pcall(p.stop)
	model:Destroy()
	task.wait(0.3)
end
label.Text = "done"
print("COMPARE_DONE")
`);
writeFileSync(join(out, 'default.project.json'), JSON.stringify({
  name: 'VFXCompare',
  tree: {
    $className: 'DataModel',
    Workspace: { $className: 'Workspace', Baseplate: { $className: 'Part', $properties: { Anchored: true, Size: [1024, 4, 1024], CFrame: { CFrame: { position: [0, -2, 0], orientation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] } }, Color: [0.12, 0.13, 0.16] } } },
    Lighting: { $className: 'Lighting', $properties: { ClockTime: 0, Brightness: 0.5, Ambient: [0.2, 0.2, 0.24], OutdoorAmbient: [0.1, 0.1, 0.12] }, Bloom: { $className: 'BloomEffect', $properties: { Intensity: 0.6, Size: 24, Threshold: 1.4 } } },
    Players: { $className: 'Players', $properties: { CharacterAutoLoads: false } },
    ReplicatedStorage: { $className: 'ReplicatedStorage', Effects: { $path: 'effects' }, Schedule: { $path: 'schedule.txt' } },
    StarterPlayer: { $className: 'StarterPlayer', StarterPlayerScripts: { $className: 'StarterPlayerScripts', Compare: { $path: 'src/Compare.client.lua' } } },
  },
}, null, 2));
console.log(`${frames.length} frames, hold ${HOLD}s each (~${Math.round(frames.length * (HOLD + 0.3) + 3 + frames.reduce((n, f) => n + f.tick / 60, 0))} s total)`);
