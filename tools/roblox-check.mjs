#!/usr/bin/env node
// Headless check of an exported Roblox effect: node tools/roblox-check.mjs <file.rbxmx>
// Builds a temporary place (rojo) with the model in Workspace, runs a Luau check in Roblox Studio via run-in-roblox,
// asserts the instance tree against EffectData, plays the effect on a simulated 60 Hz clock and prints a JSON summary.
// Exit codes: 0 = all checks passed, 1 = a check failed, 2 = a tool is missing / could not run (nothing is installed).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error('usage: node tools/roblox-check.mjs <file.rbxmx>');
  process.exit(2);
}

const env = { ...process.env, PATH: `${process.env.PATH ?? process.env.Path ?? ''}${delimiter}${join(homedir(), '.cargo', 'bin')}` };
const missing = [];
for (const [tool, args] of [['rojo', ['--version']], ['run-in-roblox', ['--version']]]) {
  const r = spawnSync(tool, args, { env, encoding: 'utf8' });
  if (r.error || r.status !== 0) missing.push(`${tool} (${r.error ? r.error.code ?? r.error.message : `exit ${r.status}`})`);
}
if (missing.length) {
  console.error(`roblox-check: missing tools on PATH (also looked in ${join(homedir(), '.cargo', 'bin')}): ${missing.join(', ')}`);
  process.exit(2);
}

const CHECK_LUAU = String.raw`
local HttpService = game:GetService("HttpService")
local Workspace = game:GetService("Workspace")
local errors, notes = {}, {}
local function fail(msg) table.insert(errors, tostring(msg)) end
local summary = { emitters = 0, beamLayers = 0, lights = 0, emitCalls = 0, totalEmit = 0, maxBeamsEnabled = 0, beamsCreated = 0, ticksPlayed = 0, enums = {}, errors = errors }

local model
for _, c in ipairs(Workspace:GetChildren()) do
	if c:IsA("Model") then model = c break end
end
if not model then
	fail("no Model in Workspace")
	print("ROBLOX_CHECK_JSON " .. HttpService:JSONEncode(summary))
	return
end
summary.model = model.Name

local ok, data = pcall(function() return require(model:FindFirstChild("EffectData")) end)
if not ok then fail("require EffectData: " .. tostring(data)) print("ROBLOX_CHECK_JSON " .. HttpService:JSONEncode(summary)) return end
local ok2, Player = pcall(function() return require(model:FindFirstChild("EffectPlayer")) end)
if not ok2 then fail("require EffectPlayer: " .. tostring(Player)) print("ROBLOX_CHECK_JSON " .. HttpService:JSONEncode(summary)) return end
summary.durationTicks = data.durationTicks
summary.pivotOk = model.PrimaryPart ~= nil
if not model.PrimaryPart then fail("Model.PrimaryPart missing") end

-- instance tree vs EffectData
local eFolder, bFolder, lFolder = model:FindFirstChild("Emitters"), model:FindFirstChild("Beams"), model:FindFirstChild("Lights")
if not (eFolder and bFolder and lFolder) then fail("missing Emitters/Beams/Lights folder") end
local demo = model:FindFirstChild("Demo")
if not (demo and demo:IsA("Script") and demo.Disabled) then fail("Demo script missing or not Disabled") end
local function enumName(v) return v.Name end
for _, d in ipairs(data.emitters) do
	local part = eFolder and eFolder:FindFirstChild(d.name)
	local em = part and part:FindFirstChildOfClass("ParticleEmitter")
	if not (part and em) then
		fail("emitter missing: " .. d.name)
	else
		summary.emitters += 1
		if em.Rate ~= 0 then fail(d.name .. ": Rate ~= 0") end
		if not em.Enabled then fail(d.name .. ": Enabled false") end
		if part.Transparency ~= 1 or not part.Anchored or part.CanCollide then fail(d.name .. ": part flags") end
		if enumName(em.Shape) ~= d.info.shape then fail(d.name .. ": Shape " .. enumName(em.Shape) .. " ~= " .. d.info.shape) end
		if enumName(em.ShapeStyle) ~= d.info.shapeStyle then fail(d.name .. ": ShapeStyle") end
		if enumName(em.ShapeInOut) ~= d.info.shapeInOut then fail(d.name .. ": ShapeInOut") end
		if enumName(em.Orientation) ~= d.info.orientation then fail(d.name .. ": Orientation " .. enumName(em.Orientation) .. " ~= " .. d.info.orientation) end
		if enumName(em.FlipbookLayout) ~= d.info.flipbookLayout then fail(d.name .. ": FlipbookLayout " .. enumName(em.FlipbookLayout) .. " ~= " .. d.info.flipbookLayout) end
		if enumName(em.FlipbookMode) ~= d.info.flipbookMode then fail(d.name .. ": FlipbookMode") end
		if enumName(em.EmissionDirection) ~= "Top" then fail(d.name .. ": EmissionDirection") end
		if em.Texture == "" then fail(d.name .. ": Texture empty") end
		local up = part.CFrame.UpVector
		summary.enums[d.name] = { shape = em.Shape.Value, shapeStyle = em.ShapeStyle.Value, shapeInOut = em.ShapeInOut.Value, orientation = em.Orientation.Value, flipbookLayout = em.FlipbookLayout.Value, flipbookMode = em.FlipbookMode.Value, emissionDirection = em.EmissionDirection.Value, up = string.format("%.2f,%.2f,%.2f", up.X, up.Y, up.Z) }
		local kp = em.Size.Keypoints
		if kp[1].Time ~= 0 or kp[#kp].Time ~= 1 or #kp > 20 then fail(d.name .. ": Size sequence") end
		local okB, br = pcall(function() return em.Brightness end)
		if not okB then fail(d.name .. ": Brightness property missing") end
	end
end
local beamTemplates = 0
for _, d in ipairs(data.beams) do
	local folder = bFolder and bFolder:FindFirstChild(d.name)
	local tpl = folder and folder:FindFirstChildOfClass("Beam")
	if not tpl then
		fail("beam template missing: " .. d.name)
	else
		summary.beamLayers += 1
		beamTemplates += 1
		if not tpl.FaceCamera then fail(d.name .. ": FaceCamera") end
	end
end
for _, d in ipairs(data.lights) do
	local part = lFolder and lFolder:FindFirstChild(d.name)
	local light = part and part:FindFirstChildOfClass("PointLight")
	if not light then fail("light missing: " .. d.name) else summary.lights += 1 end
end

-- trails: instance tree
local tFolder = model:FindFirstChild("Trails")
summary.trails = 0
for _, d in ipairs(data.trails or {}) do
	local part = tFolder and tFolder:FindFirstChild(d.name)
	local tr = part and part:FindFirstChildOfClass("Trail")
	if not tr then fail("trail missing: " .. d.name)
	else
		summary.trails += 1
		if not (tr.Attachment0 and tr.Attachment1) then fail(d.name .. ": trail attachments") end
	end
end
summary.trailEnabledSteps = 0

-- play on a simulated 60 Hz clock
local perEmitter = {}
local maxRate, maxBright = {}, 0
local player = Player.create(model, nil, {
	loop = false,
	onEmit = function(em, count)
		summary.emitCalls += 1
		summary.totalEmit += count
		perEmitter[em.Name] = (perEmitter[em.Name] or 0) + count
	end,
})
local rig = model:FindFirstChild("_BeamRig")
local maxSteps = data.durationTicks + 60 * 60
local steps = 0
while not player.isDone() and steps < maxSteps do
	steps += 1
	local okStep, err = pcall(player.update, 1 / 60)
	if not okStep then fail("update error at step " .. steps .. ": " .. tostring(err)) break end
	for _, part in ipairs(eFolder:GetChildren()) do
		local em = part:FindFirstChildOfClass("ParticleEmitter")
		if em then maxRate[em.Name] = math.max(maxRate[em.Name] or 0, em.Rate) end
	end
	for _, part in ipairs(lFolder:GetChildren()) do
		local l = part:FindFirstChildOfClass("PointLight")
		if l then maxBright = math.max(maxBright, l.Brightness) end
	end
	if tFolder then
		for _, part in ipairs(tFolder:GetChildren()) do
			local tr = part:FindFirstChildOfClass("Trail")
			if tr and tr.Enabled then summary.trailEnabledSteps += 1 break end
		end
	end
	if rig and rig.Parent then
		local enabled = 0
		for _, c in ipairs(rig:GetChildren()) do
			if c:IsA("Beam") then
				if c.Enabled then
					enabled += 1
					local p0, p1 = c.Attachment0.Position, c.Attachment1.Position
					if p0 ~= p0 or p1 ~= p1 or c.Width0 ~= c.Width0 or c.Width1 ~= c.Width1 then fail("NaN beam at step " .. steps) end
				end
				summary.beamsCreated = math.max(summary.beamsCreated, 0)
			end
		end
		summary.maxBeamsEnabled = math.max(summary.maxBeamsEnabled, enabled)
		local total = 0
		for _, c in ipairs(rig:GetChildren()) do if c:IsA("Beam") then total += 1 end end
		summary.beamsCreated = math.max(summary.beamsCreated, total)
	end
end
summary.ticksPlayed = steps
if #(data.trails or {}) > 0 and summary.trailEnabledSteps == 0 then fail("no trail was ever enabled") end
if not player.isDone() then fail("player did not finish within " .. maxSteps .. " steps") end
if rig and rig.Parent then fail("beam rig not cleaned up") end
for _, part in ipairs(eFolder:GetChildren()) do
	local em = part:FindFirstChildOfClass("ParticleEmitter")
	if em and em.Rate ~= 0 then fail(em.Name .. ": Rate not 0 after finish") end
end
summary.perEmitterEmit = perEmitter
summary.maxRate = maxRate
summary.maxLightBrightness = maxBright

-- Aiming: turn the effect 90 degrees, send it twice as far, at a set speed. The impact must land at the new target,
-- and when the effect has a flight, not before the retimed arrival.
if data.anchors then
	local pivot = model:GetPivot()
	local Sa = Vector3.new(data.anchors.source[1], data.anchors.source[2], data.anchors.source[3])
	local Ta = Vector3.new(data.anchors.target[1], data.anchors.target[2], data.anchors.target[3])
	local L = (Ta - Sa).Magnitude
	if L > 1 then
		local src = pivot * Sa
		local tgt = src + Vector3.new(0, (Ta - Sa).Y * 2, -math.sqrt((Ta - Sa).X ^ 2 + (Ta - Sa).Z ^ 2) * 2)
		local speed = 40
		-- Authored bursts near the Target (impact) and their authored ticks.
		local impactTicks = {}
		for _, d in ipairs(data.emitters) do
			for _, b in ipairs(d.bursts or {}) do
				if b[3] and (Vector3.new(b[3], b[4], b[5]) - Ta).Magnitude < 3 then table.insert(impactTicks, b[1]) end
			end
		end
		local stepN, nearHits, earliest = 0, 0, math.huge
		local aim = Player.create(model, nil, {
			source = src, target = tgt, speed = speed, scale = 0.5,
			onEmit = function(em)
				local p = em.Parent.Position
				if (p - tgt).Magnitude < 4 then nearHits += 1; earliest = math.min(earliest, stepN) end
			end,
		})
		local beamNearTarget = false
		while not aim.isDone() and stepN < maxSteps * 3 do
			stepN += 1
			local okStep, err = pcall(aim.update, 1 / 60)
			if not okStep then fail("aimed update error: " .. tostring(err)) break end
			local r = model:FindFirstChild("_BeamRig")
			if r and not beamNearTarget then
				for _, c in ipairs(r:GetChildren()) do
					if c:IsA("Beam") and c.Enabled and ((c.Attachment0.WorldPosition - tgt).Magnitude < 3 or (c.Attachment1.WorldPosition - tgt).Magnitude < 3) then beamNearTarget = true break end
				end
			end
		end
		summary.aim = { distance = (tgt - src).Magnitude, impactBurstsNearTarget = nearHits, firstImpactStep = earliest, beamReachedTarget = beamNearTarget, steps = stepN }
		if #impactTicks > 0 and nearHits == 0 then fail("aimed: no impact burst landed near the new target") end
		if #data.beams > 0 and not beamNearTarget then fail("aimed: no beam reached the new target") end
		-- Early real hit: halfway, at step 10 -> the impact must play there within a few ticks.
		if data.travel and #impactTicks > 0 then
			local mid = src:Lerp(tgt, 0.5) + Vector3.new(0, 0, 6)
			local stepH, hitNear, hitStep = 0, 0, math.huge
			local hp = Player.create(model, nil, {
				source = src, target = tgt, speed = speed,
				onEmit = function(em)
					if (em.Parent.Position - mid).Magnitude < 4 then hitNear += 1; hitStep = math.min(hitStep, stepH) end
				end,
			})
			while not hp.isDone() and stepH < maxSteps * 3 do
				stepH += 1
				if stepH == 10 then hp.hit(mid) end
				local okStep, err = pcall(hp.update, 1 / 60)
				if not okStep then fail("hit() update error: " .. tostring(err)) break end
			end
			summary.aim.earlyHit = { near = hitNear, firstStep = hitStep }
			if hitNear == 0 then fail("hit(): no impact near the real hit point") end
			if hitStep > 10 + 3 + (impactTicks[1] - (data.travel.startTick + data.travel.travelTicks)) then fail("hit(): impact came late at step " .. hitStep) end
		end
		if data.travel and #impactTicks > 0 then
			local arrival = data.travel.startTick + (tgt - src).Magnitude / speed * 60
			summary.aim.expectedArrivalStep = arrival
			if earliest < arrival - 3 then fail("aimed: impact at step " .. earliest .. " before the retimed arrival " .. arrival) end
		end
	end
end

-- play()/stop() wiring (Heartbeat)
local okPlay, pl = pcall(function() return Player.play(model, nil, { loop = true }) end)
if okPlay then pl.stop() else fail("play(): " .. tostring(pl)) end
summary.pass = #errors == 0
print("ROBLOX_CHECK_JSON " .. HttpService:JSONEncode(summary))
`;

const dir = mkdtempSync(join(tmpdir(), 'vfx-roblox-check-'));
const keep = process.env.ROBLOX_CHECK_KEEP === '1';
let code = 0;
try {
  copyFileSync(input, join(dir, 'effect.rbxmx'));
  writeFileSync(join(dir, 'default.project.json'), JSON.stringify({
    name: 'RobloxCheck',
    tree: { $className: 'DataModel', Workspace: { $className: 'Workspace', Effect: { $path: 'effect.rbxmx' } } },
  }));
  writeFileSync(join(dir, 'check.luau'), CHECK_LUAU);
  const build = spawnSync('rojo', ['build', 'default.project.json', '-o', 'place.rbxlx'], { cwd: dir, env, encoding: 'utf8' });
  if (build.status !== 0) {
    console.error(`roblox-check: rojo build failed (exit ${build.status}):\n${build.stdout}${build.stderr}`);
    code = 2;
  } else {
    const run = spawnSync('run-in-roblox', ['--place', join(dir, 'place.rbxlx'), '--script', join(dir, 'check.luau')], { cwd: dir, env, encoding: 'utf8', timeout: 240000 });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const line = out.split(/\r?\n/).find(l => l.includes('ROBLOX_CHECK_JSON '));
    if (!line) {
      console.error(`roblox-check: run-in-roblox produced no result (exit ${run.status}${run.error ? `, ${run.error.message}` : ''}). Output:\n${out.slice(0, 4000)}`);
      code = 2;
    } else {
      const summary = JSON.parse(line.slice(line.indexOf('ROBLOX_CHECK_JSON ') + 'ROBLOX_CHECK_JSON '.length));
      console.log(JSON.stringify(summary, null, 2));
      code = summary.pass ? 0 : 1;
      const other = out.split(/\r?\n/).filter(l => l && !l.includes('ROBLOX_CHECK_JSON ') && /error|warn/i.test(l));
      if (other.length) console.error(`roblox-check: engine output mentioning errors/warnings:\n${other.slice(0, 20).join('\n')}`);
    }
  }
} finally {
  if (keep) console.error(`roblox-check: kept ${resolve(dir)}`);
  else { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Studio may still hold the place open */ } }
}
process.exit(code);
