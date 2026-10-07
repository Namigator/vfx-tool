--!nonstrict
-- EffectPlayer: replays an exported VFX effect (see EffectData) on native ParticleEmitters, Beams and PointLights.
-- Timeline is 60 ticks/s; all positions in EffectData are origin-relative studs.
--
--   local player = EffectPlayer.play(model, origin?, { loop = true })
--   player.stop()
--
-- Aiming (retargeting): pass options.source (Vector3 or CFrame, the caster) and options.target (Vector3, the hit
-- point). The effect is stretched along its authored Source->Target line to reach the target and rotated to face it
-- (sizes, widths and heights unchanged). options.speed (studs/s) or options.travelTime (s) retimes the projectile
-- flight; without them the authored speed is kept, so a farther target takes proportionally longer. Everything after
-- the arrival (impact, sparks, lights) shifts with it.
--
-- The returned handle also has setTarget(position) (follow a moving target) and hit(position?) (the projectile
-- really hit: jump to the impact now, where it happened).
--
-- options.scale (default 1) resizes the effect for your game (particle sizes, speeds, spread, beam/trail widths,
-- light range, offsets across the aim line); the Source->Target reach still follows source/target.
--
-- Recolouring: options.color (Color3) turns every coloured part of the effect to that hue, keeping each part's own
-- saturation and brightness (white-hot cores stay white); options.hueShift (degrees) instead turns every hue by the
-- same amount, so multicoloured effects keep their variety. Both work on any clone and can change between plays.
--
-- EffectPlayer.create(...) returns the same object plus update(dt) / isDone() so a host can drive time itself
-- (used by tools/roblox-check.mjs); options.onEmit(emitter, count) is called for every :Emit.

local RunService = game:GetService("RunService")

local TICK_RATE = 60

local EffectPlayer = {}

local function evalKeys(keys, t)
	-- keys: { {tick, value}, ... } ascending; linear between keys, held outside.
	local n = #keys
	if t <= keys[1][1] then
		return keys[1][2]
	end
	if t >= keys[n][1] then
		return keys[n][2]
	end
	local lo, hi = 1, n
	while hi - lo > 1 do
		local mid = (lo + hi) // 2
		if keys[mid][1] <= t then
			lo = mid
		else
			hi = mid
		end
	end
	local a, b = keys[lo], keys[lo + 1]
	return a[2] + (b[2] - a[2]) * ((t - a[1]) / (b[1] - a[1]))
end

local function scaleSequence(seq, s)
	local out = {}
	for i, k in ipairs(seq.Keypoints) do
		out[i] = NumberSequenceKeypoint.new(k.Time, k.Value * s, k.Envelope * s)
	end
	return NumberSequence.new(out)
end

local function buildColor(flat, recolor)
	local out = {}
	for i = 1, #flat, 4 do
		local c = Color3.new(flat[i + 1], flat[i + 2], flat[i + 3])
		out[#out + 1] = ColorSequenceKeypoint.new(flat[i], if recolor then recolor(c) else c)
	end
	return ColorSequence.new(out)
end

-- options.color / options.hueShift -> a Color3 mapper (nil = keep the authored colours).
local function makeRecolor(opts)
	local target, shift = opts.color, opts.hueShift
	if not target and not (shift and shift ~= 0) then
		return nil
	end
	local th = if target then (target:ToHSV()) else nil
	return function(c: Color3): Color3
		local h, s, v = c:ToHSV()
		if s < 0.08 then
			return c -- white / grey parts keep their look
		end
		h = if th then th else (h + shift / 360) % 1
		return Color3.fromHSV(h, s, v)
	end
end

-- Recolours instance property `prop` from its authored value (kept in an attribute, so replays and clones never
-- compound a shift); with no recolor the authored value is restored.
local function applyRecolor(inst: Instance, prop: string, recolor)
	local attr = "VfxBase" .. prop
	local base = inst:GetAttribute(attr)
	if base == nil then
		base = (inst :: any)[prop]
		inst:SetAttribute(attr, base)
	end
	if typeof(base) == "ColorSequence" then
		if recolor then
			local out = {}
			for i, kp in ipairs(base.Keypoints) do
				out[i] = ColorSequenceKeypoint.new(kp.Time, recolor(kp.Value))
			end
			base = ColorSequence.new(out)
		end
	elseif typeof(base) == "Color3" and recolor then
		base = recolor(base)
	end
	(inst :: any)[prop] = base
end

local function buildNumbers(flat)
	local out = {}
	for i = 1, #flat, 3 do
		out[#out + 1] = NumberSequenceKeypoint.new(flat[i], flat[i + 1], flat[i + 2])
	end
	return NumberSequence.new(out)
end

local function lerpFlat(a, b, f)
	if #a ~= #b or f <= 0 then
		return a
	end
	local out = table.create(#a)
	for i = 1, #a do
		-- index 1 of every stride is the key time: identical across frames, so lerping it is harmless.
		out[i] = a[i] + (b[i] - a[i]) * f
	end
	return out
end

export type Options = {
	loop: boolean?,
	onEmit: ((ParticleEmitter, number) -> ())?,
	source: (Vector3 | CFrame)?,
	target: Vector3?,
	speed: number?,
	travelTime: number?,
	scale: number?,
	color: Color3?,
	hueShift: number?,
}

-- Right-handed frame (forward, up, side) around a direction; up follows +Y unless the direction is near vertical.
local function frameOf(dir: Vector3): (Vector3, Vector3, Vector3)
	local u = dir.Unit
	local ref = if math.abs(u.Y) < 0.95 then Vector3.yAxis else Vector3.xAxis
	local w = u:Cross(ref).Unit
	return u, w:Cross(u), w
end

function EffectPlayer.create(model: Model, origin: CFrame?, options: Options?)
	local opts = options or {}
	local data = require(model:FindFirstChild("EffectData"))
	local pivot = model:GetPivot()
	local originCF = origin or pivot
	local duration = data.durationTicks
	local onEmit = opts.onEmit
	local recolor = makeRecolor(opts)

	-- Space: authored origin-relative studs -> world. Default = the origin CFrame; with a target, the Source->Target
	-- line is stretched onto the runtime source->target and the effect is rotated to face it.
	local k = if opts.scale and opts.scale > 0 then opts.scale else 1
	local toWorld: (Vector3) -> Vector3 = function(p)
		return originCF * (p * k)
	end
	local worldRot: CFrame = originCF.Rotation
	local stretch = 1
	local anchors = data.anchors
	local Sa = anchors and Vector3.new(anchors.source[1], anchors.source[2], anchors.source[3])
	local Ta = anchors and Vector3.new(anchors.target[1], anchors.target[2], anchors.target[3])
	local runSource: Vector3? = nil
	-- Maps the authored Source->Target line onto runSource->t (called again by setTarget / hit).
	local function aimAt(t: Vector3)
		if not (Sa and Ta and runSource) then
			return
		end
		local s = runSource
		local D = Ta - Sa
		local runDir = t - s
		if D.Magnitude <= 1e-3 or runDir.Magnitude <= 1e-3 then
			return
		end
		local ua, upa, wa = frameOf(D)
		local v, upr, wr = frameOf(runDir)
		stretch = runDir.Magnitude / D.Magnitude
		toWorld = function(p)
			local d = p - Sa
			return s + v * (d:Dot(ua) * stretch) + (upr * d:Dot(upa) + wr * d:Dot(wa)) * k
		end
		worldRot = CFrame.fromMatrix(Vector3.zero, v, upr, wr) * CFrame.fromMatrix(Vector3.zero, ua, upa, wa):Inverse()
	end
	if opts.target and anchors then
		local src = opts.source
		runSource = if typeof(src) == "CFrame" then src.Position elseif typeof(src) == "Vector3" then src else originCF * Sa
		aimAt(opts.target)
	end

	-- Time: the flight [start, start + travel) is retimed; later ticks shift by the difference.
	local flightStart, flightA, flightR = 0, 0, 0
	if data.travel and data.travel.travelTicks > 0 then
		flightStart, flightA = data.travel.startTick, data.travel.travelTicks
		flightR = flightA * stretch
		if opts.target and opts.speed and opts.speed > 0 and anchors then
			flightR = (Ta - Sa).Magnitude * stretch / opts.speed * TICK_RATE
		elseif opts.travelTime and opts.travelTime > 0 then
			flightR = opts.travelTime * TICK_RATE
		end
		flightR = math.max(1, flightR)
	end
	local runDuration = duration + (flightR - flightA)
	local function authoredAt(n: number): number
		if flightA <= 0 or n <= flightStart then
			return n
		elseif n < flightStart + flightR then
			return flightStart + (n - flightStart) * flightA / flightR
		end
		return n - (flightR - flightA)
	end

	local emittersFolder = model:FindFirstChild("Emitters")
	local beamsFolder = model:FindFirstChild("Beams")
	local lightsFolder = model:FindFirstChild("Lights")

	local rig = Instance.new("Part")
	rig.Name = "_BeamRig"
	rig.Anchored = true
	rig.CanCollide = false
	rig.CanTouch = false
	rig.CanQuery = false
	rig.Transparency = 1
	rig.Size = Vector3.new(0.1, 0.1, 0.1)
	rig.CFrame = CFrame.identity -- Beam attachments are placed in world space (toWorld).
	rig.Parent = model

	local emitters = {}
	local maxLifetime = 0
	for _, d in ipairs(data.emitters) do
		local part = emittersFolder and emittersFolder:FindFirstChild(d.name)
		local em = part and part:FindFirstChildOfClass("ParticleEmitter")
		if part and em then
			applyRecolor(em, "Color", recolor)
			local rel = pivot:ToObjectSpace(part.CFrame)
			local s = {
				d = d,
				part = part,
				em = em,
				rot = rel - rel.Position,
				home = Vector3.new(d.pos[1], d.pos[2], d.pos[3]),
				baseSpeed = if k ~= 1 then NumberRange.new(em.Speed.Min * k, em.Speed.Max * k) else em.Speed,
				baseLife = em.Lifetime,
				baseSize = if k ~= 1 then scaleSequence(em.Size, k) else em.Size,
				baseAccel = em.Acceleration * k,
				baseDrag = em.Drag,
				baseColor = em.Color,
				baseTransparency = em.Transparency,
			}
			local lifeScale = 1
			if d.tracks and d.tracks.LifetimeScale then
				for _, k in ipairs(d.tracks.LifetimeScale) do
					lifeScale = math.max(lifeScale, k[2])
				end
			end
			maxLifetime = math.max(maxLifetime, s.baseLife.Max * lifeScale)
			if k ~= 1 then
				part.Size = part.Size * k
			end
			table.insert(emitters, s)
		end
	end

	local beamLayers = {}
	local beamByName = {}
	for _, d in ipairs(data.beams or {}) do
		beamByName[d.name] = d
	end
	for _, d in ipairs(data.beams or {}) do
		local folder = beamsFolder and beamsFolder:FindFirstChild(d.name)
		local template = folder and folder:FindFirstChildOfClass("Beam")
		if template then
			applyRecolor(template, "Color", recolor)
			-- Layers sharing a bolt (d.src) read the root layer's frames with widths x d.ratio.
			local root = (d.src and beamByName[d.src]) or d
			local frames = root.frames or {}
			local fullIdx, nextFull = {}, {}
			local last = 0
			for i, fr in ipairs(frames) do
				if type(fr[2]) == "table" then
					last = i
				end
				fullIdx[i] = last
			end
			local nxt = 0
			for i = #frames, 1, -1 do
				nextFull[i] = nxt
				if type(frames[i][2]) == "table" then
					nxt = i
				end
			end
			table.insert(beamLayers, {
				d = d,
				template = template,
				pool = {},
				used = 0,
				key = nil,
				frames = frames,
				fullIdx = fullIdx,
				nextFull = nextFull,
				ratio = d.ratio or 1,
				interp = root.interpolate == true or d.interpolate == true,
			})
		end
	end

	local lights = {}
	for _, d in ipairs(data.lights or {}) do
		local part = lightsFolder and lightsFolder:FindFirstChild(d.name)
		local light = part and part:FindFirstChildOfClass("PointLight")
		if part and light then
			applyRecolor(light, "Color", recolor)
			local rel = pivot:ToObjectSpace(part.CFrame)
			if k ~= 1 then
				light.Range = math.min(60, light.Range * k)
			end
			table.insert(lights, {
				d = d,
				part = part,
				light = light,
				rot = rel - rel.Position,
				home = Vector3.new(d.pos[1], d.pos[2], d.pos[3]),
			})
		end
	end

	local trailsFolder = model:FindFirstChild("Trails")
	local trails = {}
	for _, d in ipairs(data.trails or {}) do
		local part = trailsFolder and trailsFolder:FindFirstChild(d.name)
		local trail = part and part:FindFirstChildOfClass("Trail")
		if part and trail then
			local rel = pivot:ToObjectSpace(part.CFrame)
			if k ~= 1 then
				for _, att in ipairs(part:GetChildren()) do
					if att:IsA("Attachment") then
						att.Position = att.Position * k
					end
				end
			end
			table.insert(trails, { d = d, part = part, trail = trail, rot = rel - rel.Position, home = Vector3.new(d.pos[1], d.pos[2], d.pos[3]) })
			maxLifetime = math.max(maxLifetime, trail.Lifetime)
		end
	end

	-- Mesh particles (rocks, crystals...): a pool of cloned template Parts per layer, moved along baked frames.
	local meshesFolder = model:FindFirstChild("Meshes")
	local meshRig = Instance.new("Folder")
	meshRig.Name = "_MeshRig"
	meshRig.Parent = model
	local meshLayers = {}
	for _, d in ipairs(data.meshes or {}) do
		local template = meshesFolder and meshesFolder:FindFirstChild(d.name)
		if template and template:IsA("BasePart") then
			applyRecolor(template, "Color", recolor)
			table.insert(meshLayers, {
				d = d,
				template = template,
				stride = d.stride,
				varies = d.stride > 10,
				baseTransparency = d.transparency or 0,
				free = {},
				active = {},
				nextI = 1,
			})
		end
	end

	local elapsed = 0
	local phase = "run" -- run | tail | done
	local stopped = false
	local connection = nil

	local function placePart(s, p)
		s.part.CFrame = CFrame.new(toWorld(p)) * worldRot * s.rot
	end

	-- Sparse per-tick paths: between two consecutive-tick entries the position is blended by the fractional tick
	-- (a retimed, slowed flight glides instead of stepping).
	local function pathAt(path, i: number, a: number): Vector3?
		local e = path[i - 1]
		if not e then
			return nil
		end
		local p = Vector3.new(e[2], e[3], e[4])
		local n = path[i]
		if n and n[1] - e[1] == 1 and a > e[1] then
			local f = math.min(1, a - e[1])
			p = p:Lerp(Vector3.new(n[2], n[3], n[4]), f)
		end
		return p
	end

	local function releaseMesh(layer, piece)
		local part = piece.part
		piece.part = nil
		if part then
			part.Parent = nil
			table.insert(layer.free, part)
		end
	end

	local function releaseAllMeshes()
		for _, layer in ipairs(meshLayers) do
			for _, piece in ipairs(layer.active) do
				releaseMesh(layer, piece)
			end
			table.clear(layer.active)
		end
	end

	local function resetState()
		elapsed = 0
		phase = "run"
		releaseAllMeshes()
		for _, layer in ipairs(meshLayers) do
			layer.nextI = 1
		end
		for _, s in ipairs(emitters) do
			local em = s.em
			em.Rate = 0
			em.Speed = s.baseSpeed
			em.Lifetime = s.baseLife
			em.Size = s.baseSize
			em.Acceleration = s.baseAccel
			em.Drag = s.baseDrag
			em.Color = s.baseColor
			em.Transparency = s.baseTransparency
			s.rateI, s.burstI, s.pathI, s.cfI = 1, 1, 1, 1
			s.applied = {}
			s.cfKey = nil
			s.pos = s.home
			placePart(s, s.pos)
		end
		for _, layer in ipairs(beamLayers) do
			layer.key = nil
			for _, b in ipairs(layer.pool) do
				b.beam.Enabled = false
			end
			layer.used = 0
		end
		for _, l in ipairs(lights) do
			l.light.Brightness = 0
			l.brightI, l.pathI = 1, 1
			l.pos = l.home
			placePart(l, l.pos)
		end
		for _, t in ipairs(trails) do
			t.trail.Enabled = false
			t.pathI = 1
			t.pos = t.home
			placePart(t, t.pos)
			t.trail:Clear()
		end
		rig.CFrame = CFrame.identity
	end

	local function getBeam(layer, index)
		local b = layer.pool[index]
		if b then
			return b
		end
		local a0 = Instance.new("Attachment")
		local a1 = Instance.new("Attachment")
		a0.Parent = rig
		a1.Parent = rig
		local beam = layer.template:Clone()
		beam.Name = layer.d.name
		beam.Attachment0 = a0
		beam.Attachment1 = a1
		beam.Enabled = false
		beam.Parent = rig
		b = { beam = beam, a0 = a0, a1 = a1, alpha = -1 }
		layer.pool[index] = b
		return b
	end

	local function decode(path)
		-- path = { alpha, "x y z w x y z w ...", decoded? }
		local pts = path[3]
		if not pts then
			pts = {}
			for token in string.gmatch(path[2], "%S+") do
				pts[#pts + 1] = tonumber(token)
			end
			path[3] = pts
		end
		return pts
	end

	local function sameShape(pa, pb)
		if #pa ~= #pb then
			return false
		end
		for i = 1, #pa do
			if #decode(pa[i]) ~= #decode(pb[i]) then
				return false
			end
		end
		return true
	end

	local function hideLayer(layer)
		for i = 1, layer.used do
			local b = layer.pool[i]
			if b then
				b.beam.Enabled = false
			end
		end
		layer.used = 0
	end

	local function updateBeams(layer, tick)
		local frames = layer.frames
		if #frames == 0 then
			return
		end
		-- last frame with frame.tick <= tick
		local idx = 0
		local lo, hi = 1, #frames
		if frames[1][1] <= tick then
			while lo < hi do
				local mid = (lo + hi + 1) // 2
				if frames[mid][1] <= tick then
					lo = mid
				else
					hi = mid - 1
				end
			end
			idx = lo
		end
		local key = if layer.interp then tick else idx
		if key == layer.key then
			return
		end
		layer.key = key
		local a = if idx > 0 then layer.fullIdx[idx] else 0
		if a == 0 then
			hideLayer(layer)
			return
		end
		local frame = frames[idx]
		local scale = 1
		if frame[2] == false then
			scale = frame[3]
		end
		local A = frames[a]
		local pathsA = A[2]
		local pathsB, f = nil, 0
		if layer.interp then
			local nb = layer.nextFull[a]
			if nb and nb > 0 and tick > A[1] then
				local B = frames[nb]
				if A[3] == nil then
					A[3] = sameShape(pathsA, B[2])
				end
				if A[3] then
					pathsB = B[2]
					f = math.min(1, (tick - A[1]) / (B[1] - A[1]))
				end
			end
		end
		local wmul = scale * layer.ratio * k
		local baseT = layer.d.transparency
		local seg = 0
		for pi, pa in ipairs(pathsA) do
			local ptsA = decode(pa)
			local pb = pathsB and pathsB[pi]
			local ptsB = pb and decode(pb)
			local alpha = pa[1]
			if pb then
				alpha = alpha + (pb[1] - alpha) * f
			end
			local n = #ptsA // 4
			local function pos(o)
				if ptsB then
					return Vector3.new(
						ptsA[o + 1] + (ptsB[o + 1] - ptsA[o + 1]) * f,
						ptsA[o + 2] + (ptsB[o + 2] - ptsA[o + 2]) * f,
						ptsA[o + 3] + (ptsB[o + 3] - ptsA[o + 3]) * f
					)
				end
				return Vector3.new(ptsA[o + 1], ptsA[o + 2], ptsA[o + 3])
			end
			local function width(o)
				local w = ptsA[o + 4]
				if ptsB then
					w = w + (ptsB[o + 4] - w) * f
				end
				return math.max(w * wmul, 0)
			end
			for i = 1, n - 1 do
				seg += 1
				local b = getBeam(layer, seg)
				local o = (i - 1) * 4
				b.a0.Position = toWorld(pos(o))
				b.a1.Position = toWorld(pos(o + 4))
				b.beam.Width0 = width(o)
				b.beam.Width1 = width(o + 4)
				if b.alpha ~= alpha then
					b.alpha = alpha
					b.beam.Transparency = NumberSequence.new(1 - (1 - baseT) * alpha)
				end
				b.beam.Enabled = true
			end
		end
		for i = seg + 1, layer.used do
			local b = layer.pool[i]
			if b then
				b.beam.Enabled = false
			end
		end
		layer.used = seg
	end

	local function hideBeams()
		for _, layer in ipairs(beamLayers) do
			for _, b in ipairs(layer.pool) do
				b.beam.Enabled = false
			end
			layer.used = 0
			layer.key = nil
		end
	end

	local function applyTracks(s, tick)
		local tracks = s.d.tracks
		if not tracks then
			return
		end
		local em = s.em
		for prop, keys in pairs(tracks) do
			local v = evalKeys(keys, tick)
			if s.applied[prop] ~= v then
				s.applied[prop] = v
				if prop == "SpeedScale" then
					em.Speed = NumberRange.new(s.baseSpeed.Min * v, s.baseSpeed.Max * v)
				elseif prop == "LifetimeScale" then
					em.Lifetime = NumberRange.new(s.baseLife.Min * v, s.baseLife.Max * v)
				elseif prop == "SizeScale" then
					em.Size = scaleSequence(s.baseSize, v)
				elseif prop == "Drag" then
					em.Drag = v
				elseif prop == "AccelerationY" then
					em.Acceleration = Vector3.new(s.baseAccel.X, v, s.baseAccel.Z)
				end
			end
		end
	end

	local function applyColorFrames(s, tick)
		local frames = s.d.colorFrames
		if not frames then
			return
		end
		local n = #frames
		local lo = 1
		if tick >= frames[n][1] then
			lo = n
		elseif tick > frames[1][1] then
			local l, h = 1, n
			while h - l > 1 do
				local mid = (l + h) // 2
				if frames[mid][1] <= tick then
					l = mid
				else
					h = mid
				end
			end
			lo = l
		end
		local a = frames[lo]
		local f = 0
		local b = a
		if lo < n and tick > a[1] then
			b = frames[lo + 1]
			f = (tick - a[1]) / (b[1] - a[1])
		end
		local key = lo + f
		if s.cfKey == key then
			return
		end
		s.cfKey = key
		s.em.Color = buildColor(lerpFlat(a[2], b[2], f), recolor)
		s.em.Transparency = buildNumbers(lerpFlat(a[3], b[3], f))
	end

	local function stepEmitter(s, tick, a)
		local d = s.d
		local em = s.em
		local rate = d.rate
		while s.rateI <= #rate and rate[s.rateI][1] <= tick do
			em.Rate = rate[s.rateI][2]
			s.rateI += 1
		end
		local path = d.path
		if path then
			while s.pathI <= #path and path[s.pathI][1] <= tick do
				s.pathI += 1
			end
			local p = pathAt(path, s.pathI, a)
			if p and p ~= s.pos then
				s.pos = p
				placePart(s, p)
			end
		end
		local bursts = d.bursts
		if bursts then
			while s.burstI <= #bursts and bursts[s.burstI][1] <= tick do
				local e = bursts[s.burstI]
				local atOther = e[3] ~= nil
				if atOther then
					placePart(s, Vector3.new(e[3], e[4], e[5]))
				end
				em:Emit(e[2])
				if onEmit then
					onEmit(em, e[2])
				end
				if atOther then
					placePart(s, s.pos)
				end
				s.burstI += 1
			end
		end
		applyTracks(s, tick)
		applyColorFrames(s, tick)
	end

	local function stepLight(l, tick, a)
		local d = l.d
		local br = d.brightness
		while l.brightI <= #br and br[l.brightI][1] <= tick do
			l.light.Brightness = br[l.brightI][2]
			l.brightI += 1
		end
		local path = d.path
		if path then
			while l.pathI <= #path and path[l.pathI][1] <= tick do
				l.pathI += 1
			end
			local p = pathAt(path, l.pathI, a)
			if p and p ~= l.pos then
				l.pos = p
				placePart(l, p)
			end
		end
	end

	local function stepTrail(t, tick, a)
		local d = t.d
		local path = d.path
		if path then
			while t.pathI <= #path and path[t.pathI][1] <= tick do
				t.pathI += 1
			end
			local p = pathAt(path, t.pathI, a)
			if p and p ~= t.pos then
				t.pos = p
				placePart(t, p)
			end
		end
		local on = tick >= d.on and tick < d.off
		if t.trail.Enabled ~= on then
			t.trail.Enabled = on
		end
	end

	-- piece = { birth, death, "frames string" }; frame layout: tick px py pz qx qy qz sx sy sz [r g b transparency]
	-- (the quaternion's w is rebuilt, it is always >= 0).
	local function decodeFrames(piece)
		local nums = piece.nums
		if not nums then
			nums = {}
			for token in string.gmatch(piece[3], "%S+") do
				nums[#nums + 1] = tonumber(token)
			end
			piece.nums = nums
		end
		return nums
	end

	local function frameRotation(nums, o)
		local x, y, z = nums[o + 5], nums[o + 6], nums[o + 7]
		return CFrame.new(0, 0, 0, x, y, z, math.sqrt(math.max(0, 1 - x * x - y * y - z * z)))
	end

	local function placeMesh(layer, piece, a)
		local part = piece.part
		local nums = decodeFrames(piece)
		local stride = layer.stride
		local n = #nums // stride
		-- last frame with tick <= a
		local lo, hi = 1, n
		if nums[1] > a then
			hi = 1
		end
		while lo < hi do
			local mid = (lo + hi + 1) // 2
			if nums[(mid - 1) * stride + 1] <= a then
				lo = mid
			else
				hi = mid - 1
			end
		end
		local o = (lo - 1) * stride
		local f, o2 = 0, o
		if lo < n and a > nums[o + 1] then
			o2 = o + stride
			f = math.min(1, (a - nums[o + 1]) / (nums[o2 + 1] - nums[o + 1]))
		end
		local pos = Vector3.new(nums[o + 2], nums[o + 3], nums[o + 4])
		local size = Vector3.new(nums[o + 8], nums[o + 9], nums[o + 10])
		local rot = frameRotation(nums, o)
		if f > 0 then
			pos = pos:Lerp(Vector3.new(nums[o2 + 2], nums[o2 + 3], nums[o2 + 4]), f)
			size = size:Lerp(Vector3.new(nums[o2 + 8], nums[o2 + 9], nums[o2 + 10]), f)
			rot = rot:Lerp(frameRotation(nums, o2), f)
		end
		size = size * k
		part.CFrame = CFrame.new(toWorld(pos)) * worldRot * rot
		part.Size = Vector3.new(math.max(size.X, 0.05), math.max(size.Y, 0.05), math.max(size.Z, 0.05))
		local tiny = math.max(size.X, size.Y, size.Z) < 0.06
		if layer.varies then
			local r, g, b, tr = nums[o + 11], nums[o + 12], nums[o + 13], nums[o + 14]
			if f > 0 then
				r += (nums[o2 + 11] - r) * f
				g += (nums[o2 + 12] - g) * f
				b += (nums[o2 + 13] - b) * f
				tr += (nums[o2 + 14] - tr) * f
			end
			part.Color = if recolor then recolor(Color3.new(r, g, b)) else Color3.new(r, g, b)
			part.Transparency = if tiny then 1 else tr
		else
			part.Transparency = if tiny then 1 else layer.baseTransparency
		end
	end

	local function updateMeshes(a)
		for _, layer in ipairs(meshLayers) do
			local pieces = layer.d.pieces
			-- births due (a piece whose whole life already passed, e.g. after hit(), is skipped)
			while layer.nextI <= #pieces and pieces[layer.nextI][1] <= a do
				local piece = pieces[layer.nextI]
				layer.nextI += 1
				if piece[2] >= a then
					local part = table.remove(layer.free)
					if not part then
						part = layer.template:Clone()
						part.Name = layer.d.name
					end
					piece.part = part
					part.Parent = meshRig
					table.insert(layer.active, piece)
				end
			end
			local active = layer.active
			local i = 1
			while i <= #active do
				local piece = active[i]
				if piece[2] < a then
					releaseMesh(layer, piece)
					active[i] = active[#active]
					active[#active] = nil
				else
					placeMesh(layer, piece, a)
					i += 1
				end
			end
		end
	end

	local function finishRun()
		releaseAllMeshes()
		for _, s in ipairs(emitters) do
			s.em.Rate = 0
		end
		for _, t in ipairs(trails) do
			t.trail.Enabled = false
		end
		for _, l in ipairs(lights) do
			l.light.Brightness = 0
		end
		hideBeams()
		phase = "tail"
	end

	local function cleanup()
		if connection then
			connection:Disconnect()
			connection = nil
		end
		for _, s in ipairs(emitters) do
			s.em.Rate = 0
		end
		for _, l in ipairs(lights) do
			l.light.Brightness = 0
		end
		releaseAllMeshes()
		meshRig:Destroy()
		rig:Destroy()
	end

	local player = {}

	function player.update(dt: number)
		if stopped or phase == "done" then
			return
		end
		elapsed += dt
		if phase == "run" then
			local a = math.min(authoredAt(elapsed * TICK_RATE), duration)
			local tick = math.min(math.floor(a + 1e-6), duration)
			for _, s in ipairs(emitters) do
				stepEmitter(s, tick, a)
			end
			for _, layer in ipairs(beamLayers) do
				updateBeams(layer, tick)
			end
			for _, l in ipairs(lights) do
				stepLight(l, tick, a)
			end
			for _, t in ipairs(trails) do
				stepTrail(t, tick, a)
			end
			updateMeshes(a)
			if tick >= duration then
				finishRun()
			end
		end
		if phase == "tail" and elapsed >= runDuration / TICK_RATE + maxLifetime then
			if opts.loop then
				resetState()
			else
				phase = "done"
				cleanup()
			end
		end
	end

	-- Re-places every Part after the aim changed (static emitters never move on their own).
	local function replaceAll()
		for _, e in ipairs(emitters) do
			placePart(e, e.pos or e.home)
		end
		for _, l in ipairs(lights) do
			placePart(l, l.pos or l.home)
		end
		for _, t in ipairs(trails) do
			placePart(t, t.pos or t.home)
		end
		for _, layer in ipairs(beamLayers) do
			layer.key = nil
		end
	end

	-- Moving target (homing, a running mob): re-aims the rest of the effect at `target`; the timing stays.
	function player.setTarget(target: Vector3)
		if stopped or not runSource then
			return
		end
		aimAt(target)
		replaceAll()
	end

	-- The projectile really hit (possibly early, or somewhere else): aim at `at` (when given) and jump straight to
	-- the arrival, so the impact plays now and where it happened. No effect once the flight is over.
	function player.hit(at: Vector3?)
		if stopped or phase ~= "run" then
			return
		end
		if at and runSource then
			aimAt(at)
			replaceAll()
		end
		if flightA > 0 then
			local arrival = (flightStart + flightR) / TICK_RATE
			if elapsed < arrival then
				elapsed = arrival - 1e-6
			end
		end
	end

	function player.isDone(): boolean
		return phase == "done" or stopped
	end

	function player.stop()
		if stopped then
			return
		end
		stopped = true
		phase = "done"
		cleanup()
	end

	resetState()
	return player
end

function EffectPlayer.play(model: Model, origin: CFrame?, options: Options?)
	local player = EffectPlayer.create(model, origin, options)
	local connection
	connection = RunService.Heartbeat:Connect(function(dt)
		player.update(dt)
		if player.isDone() then
			connection:Disconnect()
		end
	end)
	local stopFn = player.stop
	function player.stop()
		connection:Disconnect()
		stopFn()
	end
	return player
end

return EffectPlayer
