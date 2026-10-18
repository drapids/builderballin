local src = debug.getinfo(1, "S").source:gsub("^@", "")
local modDir = src:match("^(.*)[/\\][Ss]cripts[/\\][^/\\]+$") or "."
local bridgeDir = modDir .. "/bridge"
local cmdPath = bridgeDir .. "/cmd.txt"
local statePath = bridgeDir .. "/state.txt"

package.path = modDir .. "/Scripts/?.lua;" .. package.path
local maps = require("maps")
local menu = require("menu")
local free = require("free")
local mapKill = false

local cfg = {
    god = false, nocd = false, infmeter = false, airjumps = false, nokill = false, ghost = false,
    pspeed = 1.0, wspeed = 1.0, jump = 1.0, grav = 1.0, air = 1.0,
    scale = 1.0, fov = 0, fevercam = false, freeze = false, spin = false, free = false, fly = 1.0,
}
local freezeAt = nil
local fovTouched = false
local locks = {}
local lastCmdRaw = nil
local lastEvt = -1
local primed = false

local Char = nil
local CharName = ""
local base = {}
local orig = {}
local applied = {}
local touched = {}
local slots = {}
local binds = {}
local bindsFor = ""
local vars = {}
local tick = 0
local killboxesOff = false

local function safe(f, ...)
    local ok, a, b = pcall(f, ...)
    if ok then return a, b end
    return nil
end

local function valid(o)
    return o ~= nil and safe(function() return o:IsValid() end) == true
end

local cache = {}
local function cached(key, ttl, finder, multi)
    local c = cache[key]
    if c and tick - c.t < ttl and (multi or valid(c.v)) then return c.v end
    local v = finder()
    cache[key] = { v = v, t = tick }
    return v
end

local function fname(o)
    return safe(function() return o:GetFName():ToString() end) or "?"
end

local function norm(s)
    return (s:lower():gsub("[^%w]", ""))
end

local function readFile(p)
    local f = io.open(p, "r")
    if not f then return nil end
    local s = f:read("*a")
    f:close()
    return s
end

local function parseCmd(raw)
    local newLocks = {}
    for line in raw:gmatch("[^\r\n]+") do
        local k, v = line:match("^([%w_]+)=(.*)$")
        if k == "lock" then
            local key, val = v:match("^(.-)|(.*)$")
            if key then newLocks[key] = val end
        elseif k == "evt" then
            local id, kind, arg = v:match("^(%d+)|([%w_]+)|?(.*)$")
            id = tonumber(id)
            if id and id > lastEvt then
                lastEvt = id
                if primed then
                    table.insert(cfg._events, { kind = kind, arg = arg })
                end
            end
        elseif k and cfg[k] ~= nil then
            if type(cfg[k]) == "boolean" then
                cfg[k] = (v == "1")
            else
                cfg[k] = tonumber(v) or cfg[k]
            end
        end
    end
    locks = newLocks
    primed = true
end
cfg._events = {}

local function owners()
    local o = {}
    if valid(Char) then
        o.char = Char
        local cmc = safe(function() return Char.CharacterMovement end)
        if valid(cmc) then o.cmc = cmc end
        local ctrl = safe(function() return Char.Controller end)
        if valid(ctrl) then o.ctrl = ctrl end
    end
    local gm = cached("gm", 60, function() return FindFirstOf("GameModeBase") end)
    if valid(gm) then o.mode = gm end
    local gi = cached("gi", 200, function() return FindFirstOf("GameInstance") end)
    if valid(gi) then o.inst = gi end
    return o
end

local numeric = { FloatProperty = true, DoubleProperty = true, IntProperty = true, Int64Property = true, ByteProperty = true }

local cmcProps = { "MaxWalkSpeed", "MaxAcceleration", "JumpZVelocity", "GravityScale", "AirControl", "GroundFriction", "BrakingDecelerationWalking", "MaxFlySpeed", "FallingLateralFriction" }

local function scanVars(o)
    local list = {}
    for owner, obj in pairs(o) do
        if owner == "cmc" then
            for _, n in ipairs(cmcProps) do
                local v = safe(function() return obj[n] end)
                if type(v) == "number" then
                    table.insert(list, { owner = owner, name = n, t = "DoubleProperty", v = v })
                end
            end
        else
            local cls = safe(function() return obj:GetClass() end)
            local cn = cls and fname(cls) or ""
            if cn:sub(-2) == "_C" then
                safe(function()
                    cls:ForEachProperty(function(p)
                        local n = p:GetFName():ToString()
                        local t = p:GetClass():GetFName():ToString()
                        if numeric[t] or t == "BoolProperty" then
                            local v = safe(function() return obj[n] end)
                            if type(v) == "number" or type(v) == "boolean" then
                                table.insert(list, { owner = owner, name = n, t = t, v = v })
                            end
                        end
                    end)
                end)
            end
        end
    end
    return list
end

local function setv(obj, n, v)
    safe(function() obj[n] = v end)
end

local function touch(cheat, key)
    touched[cheat] = touched[cheat] or {}
    touched[cheat][key] = true
end

local function partnerMax(list, owner, n)
    local ln = norm(n)
    for _, e in ipairs(list) do
        if e.owner == owner and type(e.v) == "number" then
            local en = norm(e.name)
            if en == "max" .. ln or en == ln .. "max" or en == "max" .. ln:gsub("^current", ""):gsub("^cur", "") then
                return e.v
            end
        end
    end
    return nil
end

local function isAny(s, pats)
    for _, p in ipairs(pats) do
        if s:find(p) then return true end
    end
    return false
end

local healthPats = { "health", "^hp", "hp$", "lives", "life" }
local cdPats = { "cooldown", "cool", "cd$", "recharge", "^cd" }
local meterPats = { "stamina", "energy", "meter", "mana", "fuel", "boost", "charge", "juice", "heat", "gauge" }
local counterPats = { "jump", "dash", "surf", "heli", "cling", "somersault", "flip", "zen", "fastfall", "airdash", "uses", "left", "remaining", "count" }
local canPats = { "^can", "^bcan", "ready$", "available$", "allowed$" }
local usedPats = { "used$", "spent$", "oncooldown", "cooling", "exhausted", "locked$", "^bused", "^used" }

local function applyHeuristics(o, list)
    local baseKey = CharName
    base[baseKey] = base[baseKey] or {}
    local b = base[baseKey]
    for _, e in ipairs(list) do
        local key = e.owner .. ":" .. e.name
        if b[key] == nil then b[key] = e.v end
    end
    for _, e in ipairs(list) do
        if e.owner == "char" or e.owner == "ctrl" then
            local obj = o[e.owner]
            local n = norm(e.name)
            local key = e.owner .. ":" .. e.name
            local isMax = n:find("^max") or n:find("max$") or n:find("^min")
            if cfg.god and type(e.v) == "number" and not isMax and isAny(n, healthPats) then
                local target = partnerMax(list, e.owner, e.name) or math.max(b[key] or e.v, e.v)
                if e.v < target then setv(obj, e.name, target) end
                touch("god", e.name)
            end
            if cfg.nocd then
                if type(e.v) == "number" and not isMax and isAny(n, cdPats) and (e.t == "FloatProperty" or e.t == "DoubleProperty") then
                    if e.v ~= 0 then setv(obj, e.name, 0) end
                    touch("nocd", e.name)
                elseif type(e.v) == "number" and not isMax and isAny(n, canPats) and (e.t == "FloatProperty" or e.t == "DoubleProperty" or e.t == "IntProperty") then
                    local target = math.max(1, b[key] or 1)
                    if e.v < target then setv(obj, e.name, target) end
                    touch("nocd", e.name)
                elseif type(e.v) == "boolean" and isAny(n, canPats) and not n:find("debug") then
                    if e.v ~= true then setv(obj, e.name, true) end
                    touch("nocd", e.name)
                elseif type(e.v) == "boolean" and isAny(n, usedPats) then
                    if e.v ~= false then setv(obj, e.name, false) end
                    touch("nocd", e.name)
                elseif (e.t == "IntProperty" or e.t == "ByteProperty") and not isMax and isAny(n, counterPats) then
                    local target = b[key]
                    local pm = partnerMax(list, e.owner, e.name)
                    if pm and not (n:find("used") or n:find("count")) then target = pm end
                    if target ~= nil and e.v ~= target then setv(obj, e.name, target) end
                    touch("nocd", e.name)
                end
            end
            if cfg.infmeter and type(e.v) == "number" and not isMax and isAny(n, meterPats) and not isAny(n, cdPats) then
                local target = partnerMax(list, e.owner, e.name) or b[key]
                if target ~= nil and e.v ~= target then setv(obj, e.name, target) end
                touch("infmeter", e.name)
            end
        end
    end
end

local function applyScaled(obj, prop, mult, tag)
    if not valid(obj) then return end
    local k = CharName .. tag
    if orig[k] == nil then
        orig[k] = safe(function() return obj[prop] end)
    end
    if orig[k] == nil then return end
    if applied[k] ~= mult then
        applied[k] = mult
        setv(obj, prop, orig[k] * mult)
    end
end

local function applyMovement(o)
    if not o.char then return end
    local ch = o.char
    local cmc = o.cmc
    if (ch.CustomTimeDilation or 1) ~= cfg.pspeed then setv(ch, "CustomTimeDilation", cfg.pspeed) end
    applyScaled(cmc, "JumpZVelocity", cfg.jump, ":jump")
    applyScaled(cmc, "GravityScale", cfg.grav, ":grav")
    applyScaled(cmc, "AirControl", cfg.air, ":air")

    local jk = CharName .. ":jmc"
    if orig[jk] == nil then orig[jk] = safe(function() return ch.JumpMaxCount end) end
    if cfg.airjumps then
        if ch.JumpMaxCount ~= 999 then setv(ch, "JumpMaxCount", 999) end
        touch("airjumps", "JumpMaxCount")
    elseif orig[jk] and applied[jk] then
        setv(ch, "JumpMaxCount", orig[jk])
    end
    applied[jk] = cfg.airjumps

    if cfg.god then
        if ch.bCanBeDamaged ~= false then setv(ch, "bCanBeDamaged", false) end
        touch("god", "bCanBeDamaged")
    elseif applied[CharName .. ":god"] then
        setv(ch, "bCanBeDamaged", true)
    end
    applied[CharName .. ":god"] = cfg.god

    local gk = CharName .. ":ghost"
    if cfg.ghost ~= (applied[gk] or false) then
        applied[gk] = cfg.ghost
        safe(function() ch:SetActorEnableCollision(not cfg.ghost) end)
        if valid(cmc) then
            safe(function() cmc:SetMovementMode(cfg.ghost and 5 or 3, 0) end)
        end
    end
    if cfg.ghost and valid(cmc) then
        local mm = safe(function() return cmc.MovementMode end)
        if mm ~= nil and mm ~= 5 then safe(function() cmc:SetMovementMode(5, 0) end) end
    end

    local sk = CharName .. ":scale"
    if applied[sk] ~= cfg.scale then
        applied[sk] = cfg.scale
        local sc = cfg.scale
        safe(function() ch:SetActorScale3D({ X = sc, Y = sc, Z = sc }) end)
    end

    if cfg.freeze then
        if not freezeAt then freezeAt = loc(ch) end
        if freezeAt then
            safe(function() ch:K2_SetActorLocation(freezeAt, false, {}, true) end)
            if valid(cmc) then safe(function() cmc.Velocity = { X = 0, Y = 0, Z = 0 } end) end
        end
    else
        freezeAt = nil
    end

    if cfg.spin then
        local ctrl = o.ctrl
        if valid(ctrl) then
            safe(function()
                local r = ctrl:GetControlRotation()
                ctrl:SetControlRotation({ Pitch = r.Pitch, Yaw = (r.Yaw + 9) % 360, Roll = r.Roll })
            end)
        end
    end

    local pcm = cached("pcm", 60, function() return FindFirstOf("PlayerCameraManager") end)
    if valid(pcm) then
        local want = 0
        if cfg.fevercam then
            local b = cfg.fov > 0 and cfg.fov or 95
            want = b + math.sin(os.clock() * 2.3) * 18 + math.sin(os.clock() * 5.1) * 4
        elseif cfg.fov > 0 then
            want = cfg.fov
        end
        if want > 0 then
            setv(pcm, "LockedFOV", want)
            fovTouched = true
        elseif fovTouched then
            setv(pcm, "LockedFOV", 0)
            fovTouched = false
        end
    end

    local ws = cached("ws", 60, function() return FindAllOf("WorldSettings") end, true)
    if ws then
        for _, w in ipairs(ws) do
            if valid(w) and w.TimeDilation ~= cfg.wspeed then setv(w, "TimeDilation", cfg.wspeed) end
        end
    end
end

local function applyKillboxes()
    local want = cfg.nokill or mapKill
    if not want and not killboxesOff then return end
    if (want and tick % 20 == 0) or (not want and killboxesOff) then
        local kb = cached("kb", 60, function() return FindAllOf("BP_Killbox_C") end, true)
        if kb then
            for _, k in ipairs(kb) do
                if valid(k) then
                    safe(function() k:SetActorEnableCollision(not want) end)
                    if want then touch("nokill", fname(k)) end
                end
            end
        end
    end
    killboxesOff = want
end

local function applyLocks(o)
    for key, val in pairs(locks) do
        local owner, n = key:match("^(%w+):(.+)$")
        local obj = owner and o[owner]
        if valid(obj) then
            local cur = safe(function() return obj[n] end)
            if type(cur) == "boolean" then
                local b = (val == "1" or val == "true")
                if cur ~= b then setv(obj, n, b) end
            elseif type(cur) == "number" then
                local num = tonumber(val)
                if num and cur ~= num then setv(obj, n, num) end
            end
        end
    end
end

local function loc(ch)
    local v = safe(function() return ch:K2_GetActorLocation() end)
    if not v then return nil end
    return { X = v.X, Y = v.Y, Z = v.Z }
end

local function handleEvents(o)
    local evs = cfg._events
    cfg._events = {}
    for _, e in ipairs(evs) do
        if maps.handle(e.kind, e.arg) then
        elseif e.kind == "map_picker" then
            menu.openPicker()
        elseif e.kind == "tp_save" and o.char then
            local p = loc(o.char)
            if p then slots[tonumber(e.arg) or 1] = p end
        elseif e.kind == "tp_load" and o.char then
            local p = slots[tonumber(e.arg) or 1]
            if p then
                safe(function() o.char:K2_SetActorLocation({ X = p.X, Y = p.Y, Z = p.Z }, false, {}, true) end)
                if valid(o.cmc) then
                    safe(function() o.cmc.Velocity = { X = 0, Y = 0, Z = 0 } end)
                end
            end
        elseif e.kind == "tp_goto" and o.char then
            local x, y, z = e.arg:match("^([%-%d%.]+),([%-%d%.]+),([%-%d%.]+)$")
            if x then
                local p = { X = tonumber(x), Y = tonumber(y), Z = tonumber(z) }
                safe(function() o.char:K2_SetActorLocation(p, false, {}, true) end)
                if valid(o.cmc) then
                    safe(function() o.cmc.Velocity = { X = 0, Y = 0, Z = 0 } end)
                end
                if freezeAt then freezeAt = p end
            end
        elseif e.kind == "boost" and o.char then
            local f = safe(function() return o.char:GetActorForwardVector() end)
            local pw = tonumber(e.arg) or 3000
            if f then
                safe(function() o.char:LaunchCharacter({ X = f.X * pw, Y = f.Y * pw, Z = 250 }, true, true) end)
            end
        elseif e.kind == "stop" and valid(o.cmc) then
            safe(function() o.cmc.Velocity = { X = 0, Y = 0, Z = 0 } end)
        elseif e.kind == "set" then
            local key, val = e.arg:match("^(.-)|(.*)$")
            local owner, n = (key or ""):match("^(%w+):(.+)$")
            local obj = owner and o[owner]
            if valid(obj) then
                local cur = safe(function() return obj[n] end)
                if type(cur) == "boolean" then
                    setv(obj, n, val == "1" or val == "true")
                elseif type(cur) == "number" and tonumber(val) then
                    setv(obj, n, tonumber(val))
                end
            end
        elseif e.kind == "tp_clear" then
            slots[tonumber(e.arg) or 1] = nil
        elseif e.kind == "rebase" then
            base[CharName] = nil
        elseif e.kind == "binds" then
            bindsFor = ""
        elseif e.kind == "launch" and valid(o.cmc) then
            safe(function() o.char:LaunchCharacter({ X = 0, Y = 0, Z = tonumber(e.arg) or 1500 }, false, true) end)
        end
    end
end

local function keyName(k)
    return safe(function() return k.KeyName:ToString() end) or "?"
end

local function dumpBinds(o)
    local out = {}
    local imcs = FindAllOf("InputMappingContext")
    if imcs then
        for _, imc in ipairs(imcs) do
            local ctx = fname(imc)
            local arrays = {}
            local a1 = safe(function() return imc.DefaultKeyMappings.Mappings end)
            if a1 then table.insert(arrays, a1) end
            local a2 = safe(function() return imc.Mappings end)
            if a2 then table.insert(arrays, a2) end
            for _, arr in ipairs(arrays) do
                safe(function()
                    arr:ForEach(function(_, el)
                        local m = el:get()
                        local act = safe(function() return fname(m.Action) end) or "?"
                        local key = keyName(m.Key)
                        local trig = {}
                        safe(function()
                            m.Triggers:ForEach(function(_, t)
                                local tc = fname(t:get():GetClass()):gsub("^InputTrigger", "")
                                table.insert(trig, tc)
                            end)
                        end)
                        table.insert(out, "imc|" .. ctx .. "|" .. act .. "|" .. key .. "|" .. table.concat(trig, "+"))
                    end)
                end)
            end
        end
    end
    local inputSettings = StaticFindObject("/Script/Engine.Default__InputSettings")
    if valid(inputSettings) then
        safe(function()
            inputSettings.ActionMappings:ForEach(function(_, el)
                local m = el:get()
                local an = safe(function() return m.ActionName:ToString() end) or "?"
                local mods = {}
                if m.bShift then table.insert(mods, "Shift") end
                if m.bCtrl then table.insert(mods, "Ctrl") end
                if m.bAlt then table.insert(mods, "Alt") end
                table.insert(out, "legacy|action|" .. an .. "|" .. keyName(m.Key) .. "|" .. table.concat(mods, "+"))
            end)
        end)
        safe(function()
            inputSettings.AxisMappings:ForEach(function(_, el)
                local m = el:get()
                local an = safe(function() return m.AxisName:ToString() end) or "?"
                table.insert(out, "legacy|axis|" .. an .. "|" .. keyName(m.Key) .. "|" .. tostring(m.Scale))
            end)
        end)
    end
    for owner, obj in pairs(o) do
        if owner == "char" or owner == "ctrl" then
            local cls = safe(function() return obj:GetClass() end)
            if cls then
                safe(function()
                    cls:ForEachFunction(function(fn)
                        local n = fn:GetFName():ToString()
                        local key = n:match("^InpActEvt_(.-)_K2Node_InputKeyEvent")
                        if key then
                            table.insert(out, "bp|" .. owner .. "|key|" .. key .. "|")
                        end
                        local act = n:match("^InpActEvt_(.-)_K2Node_InputActionEvent")
                        if act then
                            table.insert(out, "bp|" .. owner .. "|action|" .. act .. "|")
                        end
                        local ax = n:match("^InpAxisKeyEvt_(.-)_K2Node")
                        if ax then
                            table.insert(out, "bp|" .. owner .. "|axiskey|" .. ax .. "|")
                        end
                        local ia = n:match("^InpActEvt_?(IA_[%w_]-)_K2Node_EnhancedInputActionEvent")
                        if ia then
                            table.insert(out, "bp|" .. owner .. "|enhanced|" .. ia .. "|")
                        end
                    end)
                end)
            end
        end
    end
    binds = out
end

local function fmt(v)
    if type(v) == "boolean" then return v and "1" or "0" end
    if type(v) == "number" then
        if v == math.floor(v) and math.abs(v) < 1e15 then return string.format("%d", v) end
        return string.format("%.4f", v)
    end
    return tostring(v)
end

local function writeState(o, status)
    local L = {}
    table.insert(L, "status=" .. status)
    table.insert(L, "ver=9")
    table.insert(L, "tick=" .. tick)
    table.insert(L, "clock=" .. string.format("%.2f", os.clock()))
    if o.char then
        table.insert(L, "char=" .. CharName)
        local p = loc(o.char)
        if p then table.insert(L, string.format("pos=%.1f,%.1f,%.1f", p.X, p.Y, p.Z)) end
        if o.cmc then
            local vel = safe(function() return o.cmc.Velocity end)
            if vel then
                table.insert(L, string.format("vel=%.1f,%.1f,%.1f", vel.X, vel.Y, vel.Z))
            end
            local mm = safe(function() return o.cmc.MovementMode end)
            if mm then table.insert(L, "mode=" .. tostring(mm)) end
        end
        local w = safe(function() return o.char:GetWorld() end)
        if w then table.insert(L, "level=" .. fname(w)) end
    end
    for i = 1, 5 do
        local s = slots[i]
        if s then table.insert(L, string.format("slot=%d|%.1f,%.1f,%.1f", i, s.X, s.Y, s.Z)) end
    end
    for cheat, keys in pairs(touched) do
        for k, _ in pairs(keys) do
            table.insert(L, "touched=" .. cheat .. "|" .. k)
        end
    end
    for _, e in ipairs(vars) do
        table.insert(L, "var=" .. e.owner .. "|" .. e.name .. "|" .. e.t .. "|" .. fmt(e.v))
    end
    for _, b in ipairs(binds) do
        table.insert(L, "bind=" .. b)
    end
    for _, line in ipairs(maps.state()) do table.insert(L, line) end
    table.insert(L, "evt=" .. lastEvt)
    table.insert(L, "end=1")
    local f = io.open(statePath, "w")
    if f then
        f:write(table.concat(L, "\n"))
        f:close()
    end
end

local playPath = bridgeDir .. "/play.txt"
local lastPlay = nil
local playWant = nil
local function checkPlay()
    local raw = readFile(playPath)
    if raw then
        local id, file, at = raw:match("^(%d+)|([^|\r\n]+)|?(%d*)")
        if id and id ~= lastPlay then
            local first = lastPlay == nil
            lastPlay = id
            local stamp = tonumber(at)
            local fresh = stamp and math.abs(os.time() - stamp) < 120
            if not first or fresh then playWant = { file = file, giveUp = os.clock() + 90 } end
        end
    elseif lastPlay == nil then
        lastPlay = ""
    end
    if not playWant then return end
    if os.clock() > playWant.giveUp then
        playWant = nil
        return
    end
    local ch = safe(function() return FindFirstOf("BP_ThirdPersonCharacter_C") end)
    if valid(ch) then
        maps.load(playWant.file)
        playWant = nil
    elseif menu.play(playWant.file) then
        playWant = nil
    end
end

local function step()
    tick = tick + 1
    local raw = readFile(cmdPath)
    if raw and raw ~= lastCmdRaw then
        lastCmdRaw = raw
        parseCmd(raw)
    end

    local c = cached("char", 1, function()
        local pc = FindFirstOf("PlayerController")
        local pawn = valid(pc) and safe(function() return pc.Pawn end) or nil
        if valid(pawn) then return pawn end
        return FindFirstOf("BP_ThirdPersonCharacter_C")
    end)
    if valid(c) then
        local full = safe(function() return c:GetFullName() end) or "?"
        if full ~= CharName then
            cache = { char = cache.char }
            Char = c
            CharName = full
            touched = {}
            bindsFor = ""
        end
    else
        Char = nil
    end

    local o = owners()
    if o.char then
        handleEvents(o)
        applyMovement(o)
        if cfg.nocd then
            local tp = safe(function() return o.char.CanTeleport end)
            if type(tp) == "number" and tp < 1 then
                setv(o.char, "CanTeleport", 1)
                local hud = safe(function() return o.char.HUDHealth end)
                if valid(hud) then safe(function() hud:UpdateSpecial(1) end) end
                touch("nocd", "CanTeleport")
            end
        end
        if tick % 4 == 0 then
            vars = scanVars(o)
            applyHeuristics(o, vars)
        end
        applyLocks(o)
        if bindsFor ~= CharName then
            bindsFor = CharName
            dumpBinds(o)
        end
    else
        local evs = cfg._events
        cfg._events = {}
        for _, e in ipairs(evs) do maps.handle(e.kind, e.arg) end
    end
    applyKillboxes()
    menu.tick()
    if tick % 4 == 0 then checkPlay() end
    if tick % 20 == 0 then menu.scan() end

    if tick % 5 == 0 then
        writeState(o, o.char and "playing" or "menu")
    end
end

local ctx = {
    bridgeDir = bridgeDir,
    modDir = modDir,
    maps = maps,
    getChar = function()
        local c = safe(function() return FindFirstOf("BP_ThirdPersonCharacter_C") end)
        return valid(c) and c or nil
    end,
    getCmc = function()
        local ch = safe(function() return FindFirstOf("BP_ThirdPersonCharacter_C") end)
        if not valid(ch) then return nil end
        local c = safe(function() return ch.CharacterMovement end)
        return valid(c) and c or nil
    end,
    worldName = function()
        local ch = safe(function() return FindFirstOf("BP_ThirdPersonCharacter_C") end)
        if not valid(ch) then return "" end
        local w = safe(function() return ch:GetWorld() end)
        return w and fname(w) or ""
    end,
    setKillboxes = function(on) mapKill = on end,
}
maps.init(ctx)
menu.init(ctx)

local function report(prefix, err)
    local f = io.open(bridgeDir .. "/error.txt", "w")
    if f then f:write(prefix .. tostring(err)) f:close() end
end

local lastStep = -1
local busy = false
local function frame()
    if busy then return end
    busy = true
    local ok, err = pcall(maps.tick)
    if not ok then report("maps: ", err) end
    if cfg.free or free.active() then
        local ch = safe(function() return FindFirstOf("BP_ThirdPersonCharacter_C") end)
        ok, err = pcall(free.tick, valid(ch) and ch or nil, cfg.free, cfg.fly)
        if not ok then report("free: ", err) end
    end
    local now = os.clock()
    if now - lastStep >= 0.045 or now < lastStep then
        lastStep = now
        ok, err = pcall(step)
        if not ok then report("", err) end
    end
    busy = false
end

local loopKind = "none"
if type(LoopInGameThreadAfterFrames) == "function" and EngineTickAvailable then
    if pcall(LoopInGameThreadAfterFrames, 1, frame) then loopKind = "frames" end
end
if loopKind == "none" and type(LoopInGameThreadWithDelay) == "function" then
    if pcall(LoopInGameThreadWithDelay, 16, frame) then loopKind = "delay" end
end
if loopKind == "none" then
    loopKind = "async"
    local queued = false
    local function run()
        frame()
        queued = false
    end
    LoopAsync(33, function()
        if not queued then
            queued = true
            ExecuteInGameThread(run)
        end
        return false
    end)
end

print("[Hyperboi] bridge up at " .. bridgeDir .. " (" .. loopKind .. ")\n")
