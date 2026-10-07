// Headless Studio check of a pack model (tools/build-roblox-pack.mjs): every effect in every folder loads, plays to the
// end on a simulated clock without errors and emits something; colourway folders differ in hue from the first folder.
//   node tools/roblox-check-pack.mjs <pack.rbxmx>
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
const input = process.argv[2];
if (!input || !existsSync(input)) { console.error('usage: node tools/roblox-check-pack.mjs <pack.rbxmx>'); process.exit(2); }
const env = { ...process.env, PATH: `${process.env.PATH ?? process.env.Path ?? ''}${delimiter}${join(homedir(), '.cargo', 'bin')}` };
const LUAU = String.raw`
local HttpService = game:GetService("HttpService")
local pack = workspace:FindFirstChildOfClass("Model")
local out = { effects = 0, played = 0, errors = {}, folders = {}, hues = {} }
local function hueOf(model)
	local e = model:FindFirstChild("Emitters")
	for _, p in ipairs(e and e:GetChildren() or {}) do
		local em = p:FindFirstChildOfClass("ParticleEmitter")
		if em then
			for _, kp in ipairs(em.Color.Keypoints) do
				local h, s = kp.Value:ToHSV()
				if s > 0.2 then return math.floor(h * 360) end
			end
		end
	end
	return -1
end
local function run(model, folderName)
	out.effects += 1
	local ok, err = pcall(function()
		local Player = require(model:FindFirstChild("EffectPlayer"))
		local emits = 0
		local p = Player.create(model, nil, { onEmit = function(_, n) emits += n end })
		local steps = 0
		while not p.isDone() and steps < 60 * 30 do steps += 1; p.update(1 / 60) end
		local beams = model:FindFirstChild("Beams")
		local hasBeams = beams and #beams:GetChildren() > 0
		if emits == 0 and not hasBeams then error("nothing emitted") end
		out.hues[folderName .. "/" .. model.Name] = hueOf(model)
		pcall(p.stop)
	end)
	if ok then out.played += 1 else table.insert(out.errors, folderName .. "/" .. model.Name .. ": " .. tostring(err)) end
end
for _, c in ipairs(pack:GetChildren()) do
	if c:IsA("Folder") then
		out.folders[c.Name] = #c:GetChildren()
		for _, m in ipairs(c:GetChildren()) do if m:IsA("Model") then run(m, c.Name) end end
	elseif c:IsA("Model") then run(c, "") end
end
out.readme = pack:FindFirstChild("README") ~= nil
print("PACK_CHECK_JSON " .. HttpService:JSONEncode(out))
`;
const dir = mkdtempSync(join(tmpdir(), 'vfx-pack-check-'));
try {
  copyFileSync(input, join(dir, 'pack.rbxmx'));
  writeFileSync(join(dir, 'default.project.json'), JSON.stringify({ name: 'PackCheck', tree: { $className: 'DataModel', Workspace: { $className: 'Workspace', Pack: { $path: 'pack.rbxmx' } } } }));
  writeFileSync(join(dir, 'check.luau'), LUAU);
  const b = spawnSync('rojo', ['build', 'default.project.json', '-o', 'place.rbxlx'], { cwd: dir, env, encoding: 'utf8' });
  if (b.status !== 0) { console.error(b.stdout + b.stderr); process.exit(2); }
  const r = spawnSync('run-in-roblox', ['--place', join(dir, 'place.rbxlx'), '--script', join(dir, 'check.luau')], { cwd: dir, env, encoding: 'utf8', timeout: 600000 });
  const all = `${r.stdout ?? ''}${r.stderr ?? ''}`, line = all.split(/\r?\n/).find(l => l.includes('PACK_CHECK_JSON '));
  if (!line) { console.error(all.slice(0, 3000)); process.exit(2); }
  const res = JSON.parse(line.slice(line.indexOf('PACK_CHECK_JSON ') + 16));
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.errors.length ? 1 : 0);
} finally { rmSync(dir, { recursive: true, force: true }); }
