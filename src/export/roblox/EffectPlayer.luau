--!nonstrict
-- EffectPlayer: replays an exported VFX effect (see EffectData) on native ParticleEmitters, Beams and PointLights.
-- Timeline is 60 ticks/s; all positions in EffectData are origin-relative studs.
--
--   local player = EffectPlayer.play(model, origin?, { loop = true })
--   player.stop()
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

local function buildColor(flat)
	local out = {}
	for i = 1, #flat, 4 do
		out[#out + 1] = ColorSequenceKeypoint.new(flat[i], Color3.new(flat[i + 1], flat[i + 2], flat[i + 3]))
	end
	return ColorSequence.new(out)
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

function EffectPlayer.create(model: Model, origin: CFrame?, options: { loop: boolean?, onEmit: ((ParticleEmitter, number) -> ())? }?)
	local opts = options or {}
	local data = require(model:FindFirstChild("EffectData"))
	local pivot = model:GetPivot()
	local originCF = origin or pivot
	local duration = data.durationTicks
	local onEmit = opts.onEmit

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
	rig.CFrame = originCF
	rig.Parent = model

	local emitters = {}
	local maxLifetime = 0
	for _, d in ipairs(data.emitters) do
		local part = emittersFolder and emittersFolder:FindFirstChild(d.name)
		local em = part and part:FindFirstChildOfClass("ParticleEmitter")
		if part and em then
			local rel = pivot:ToObjectSpace(part.CFrame)
			local s = {
				d = d,
				part = part,
				em = em,
				rot = rel - rel.Position,
				home = Vector3.new(d.pos[1], d.pos[2], d.pos[3]),
				baseSpeed = em.Speed,
				baseLife = em.Lifetime,
				baseSize = em.Size,
				baseAccel = em.Acceleration,
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
			local rel = pivot:ToObjectSpace(part.CFrame)
			table.insert(lights, {
				d = d,
				part = part,
				light = light,
				rot = rel - rel.Position,
				home = Vector3.new(d.pos[1], d.pos[2], d.pos[3]),
			})
		end
	end

	local elapsed = 0
	local phase = "run" -- run | tail | done
	local stopped = false
	local connection = nil

	local function placePart(s, p)
		s.part.CFrame = originCF * CFrame.new(p) * s.rot
	end

	local function resetState()
		elapsed = 0
		phase = "run"
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
		rig.CFrame = originCF
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
		local wmul = scale * layer.ratio
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
				b.a0.Position = pos(o)
				b.a1.Position = pos(o + 4)
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
		s.em.Color = buildColor(lerpFlat(a[2], b[2], f))
		s.em.Transparency = buildNumbers(lerpFlat(a[3], b[3], f))
	end

	local function stepEmitter(s, tick)
		local d = s.d
		local em = s.em
		local rate = d.rate
		while s.rateI <= #rate and rate[s.rateI][1] <= tick do
			em.Rate = rate[s.rateI][2]
			s.rateI += 1
		end
		local moved = false
		local path = d.path
		if path then
			while s.pathI <= #path and path[s.pathI][1] <= tick do
				local e = path[s.pathI]
				s.pos = Vector3.new(e[2], e[3], e[4])
				moved = true
				s.pathI += 1
			end
		end
		if moved then
			placePart(s, s.pos)
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

	local function stepLight(l, tick)
		local d = l.d
		local br = d.brightness
		while l.brightI <= #br and br[l.brightI][1] <= tick do
			l.light.Brightness = br[l.brightI][2]
			l.brightI += 1
		end
		local path = d.path
		if path then
			local moved = false
			while l.pathI <= #path and path[l.pathI][1] <= tick do
				local e = path[l.pathI]
				l.pos = Vector3.new(e[2], e[3], e[4])
				moved = true
				l.pathI += 1
			end
			if moved then
				placePart(l, l.pos)
			end
		end
	end

	local function finishRun()
		for _, s in ipairs(emitters) do
			s.em.Rate = 0
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
		rig:Destroy()
	end

	local player = {}

	function player.update(dt: number)
		if stopped or phase == "done" then
			return
		end
		elapsed += dt
		if phase == "run" then
			local tick = math.min(math.floor(elapsed * TICK_RATE + 1e-6), duration)
			for _, s in ipairs(emitters) do
				stepEmitter(s, tick)
			end
			for _, layer in ipairs(beamLayers) do
				updateBeams(layer, tick)
			end
			for _, l in ipairs(lights) do
				stepLight(l, tick)
			end
			if tick >= duration then
				finishRun()
			end
		end
		if phase == "tail" and elapsed >= duration / TICK_RATE + maxLifetime then
			if opts.loop then
				resetState()
			else
				phase = "done"
				cleanup()
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

function EffectPlayer.play(model: Model, origin: CFrame?, options: { loop: boolean?, onEmit: ((ParticleEmitter, number) -> ())? }?)
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
