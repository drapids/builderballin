local M = {}

local BASE_SPEED = 6000
local on = false
local who = nil
local saved = nil
local vel = { X = 0, Y = 0, Z = 0 }
local lean = 0
local bank = 0
local bob = 0
local lastT = nil
local keyCache = {}

local function safe(f)
    local ok, r = pcall(f)
    if ok then return r end
    return nil
end

local function valid(o)
    return o ~= nil and safe(function() return o:IsValid() end) == true
end

local function key(name)
    local k = keyCache[name]
    if not k then
        k = { KeyName = FName(name) }
        keyCache[name] = k
    end
    return k
end

local function down(pc, name)
    return safe(function() return pc:IsInputKeyDown(key(name)) end) == true
end

local function lerp(a, b, t)
    return a + (b - a) * t
end

local function restore(ch)
    if not saved or not valid(ch) then return end
    local mesh = safe(function() return ch.Mesh end)
    if valid(mesh) and saved.rot and saved.loc then
        safe(function() mesh:K2_SetRelativeRotation(saved.rot, false, {}, false) end)
        safe(function() mesh:K2_SetRelativeLocation(saved.loc, false, {}, false) end)
    end
    local cmc = safe(function() return ch.CharacterMovement end)
    if valid(cmc) then
        if saved.fly then safe(function() cmc.MaxFlySpeed = saved.fly end) end
        if saved.brake then safe(function() cmc.BrakingDecelerationFlying = saved.brake end) end
        safe(function() cmc:SetMovementMode(3, 0) end)
    end
    if saved.dmg ~= nil then safe(function() ch.bCanBeDamaged = saved.dmg end) end
end

local function enter(ch)
    local mesh = safe(function() return ch.Mesh end)
    local cmc = safe(function() return ch.CharacterMovement end)
    saved = {}
    if valid(mesh) then
        local r = safe(function() return mesh.RelativeRotation end)
        local l = safe(function() return mesh.RelativeLocation end)
        if r then saved.rot = { Pitch = r.Pitch, Yaw = r.Yaw, Roll = r.Roll } end
        if l then saved.loc = { X = l.X, Y = l.Y, Z = l.Z } end
    end
    if valid(cmc) then
        saved.fly = safe(function() return cmc.MaxFlySpeed end)
        saved.brake = safe(function() return cmc.BrakingDecelerationFlying end)
        local v = safe(function() return cmc.Velocity end)
        if v then vel = { X = v.X * 0.5, Y = v.Y * 0.5, Z = 0 } end
    end
    saved.dmg = safe(function() return ch.bCanBeDamaged end)
    lean, bank, bob = 0, 0, 0
end

function M.active()
    return on
end

function M.tick(ch, want, mult)
    local now = os.clock()
    local dt = lastT and math.min(0.1, math.max(0.0005, now - lastT)) or 0.016
    lastT = now
    if not valid(ch) then
        on = false
        who = nil
        saved = nil
        return
    end
    local addr = safe(function() return ch:GetAddress() end)
    if on and who ~= addr then
        on = false
        saved = nil
    end
    if not want then
        if on then
            restore(ch)
            on = false
            saved = nil
        end
        return
    end
    if not on then
        enter(ch)
        on = true
        who = addr
    end

    local cmc = safe(function() return ch.CharacterMovement end)
    if not valid(cmc) then return end
    local pc = safe(function() return ch.Controller end)
    if not valid(pc) then return end

    local mode = safe(function() return cmc.MovementMode end)
    if mode ~= 5 then safe(function() cmc:SetMovementMode(5, 0) end) end
    local speed = BASE_SPEED * (mult or 1)
    safe(function() cmc.MaxFlySpeed = speed * 3.2 end)
    safe(function() cmc.BrakingDecelerationFlying = 0 end)
    safe(function() ch.bCanBeDamaged = false end)
    local hog = safe(function() return ch.HealthOG end)
    if type(hog) == "number" then
        local h = safe(function() return ch.Health end)
        if type(h) == "number" and h < hog then safe(function() ch.Health = hog end) end
    end

    local cr = safe(function() return pc.ControlRotation end) or { Pitch = 0, Yaw = 0 }
    local yaw = math.rad(cr.Yaw or 0)
    local pitch = math.rad(cr.Pitch or 0)
    if pitch > math.pi then pitch = pitch - 2 * math.pi end
    local fx, fy = math.cos(yaw), math.sin(yaw)
    local rx, ry = -math.sin(yaw), math.cos(yaw)

    local f, r = 0, 0
    if down(pc, "W") then f = f + 1 end
    if down(pc, "S") then f = f - 1 end
    if down(pc, "D") then r = r + 1 end
    if down(pc, "A") then r = r - 1 end
    if f == 0 and r == 0 then
        local inp = safe(function() return ch:GetLastMovementInputVector() end)
        if inp and ((inp.X or 0) ~= 0 or (inp.Y or 0) ~= 0) then
            f = inp.X * fx + inp.Y * fy
            r = inp.X * rx + inp.Y * ry
        end
    end
    local u = 0
    if down(pc, "SpaceBar") or down(pc, "Gamepad_FaceButton_Bottom") then u = u + 1 end
    if down(pc, "LeftAlt") or down(pc, "Gamepad_LeftTrigger") then u = u - 1 end
    local fast = down(pc, "LeftShift") or down(pc, "Gamepad_LeftThumbstick")

    local cp = math.cos(pitch)
    local sp = math.sin(pitch)
    local dx = fx * cp * f + rx * r
    local dy = fy * cp * f + ry * r
    local dz = sp * f + u
    local len = math.sqrt(dx * dx + dy * dy + dz * dz)
    if len > 1 then
        dx, dy, dz = dx / len, dy / len, dz / len
    end
    local top = speed * (fast and 3 or 1)
    local target = { X = dx * top, Y = dy * top, Z = dz * top }
    local k = 1 - math.exp(-dt * (len > 0.01 and 6 or 4.5))
    vel.X = lerp(vel.X, target.X, k)
    vel.Y = lerp(vel.Y, target.Y, k)
    vel.Z = lerp(vel.Z, target.Z, k)
    safe(function() cmc.Velocity = { X = vel.X, Y = vel.Y, Z = vel.Z } end)

    local hs = math.sqrt(vel.X * vel.X + vel.Y * vel.Y)
    local amt = math.min(1, math.sqrt(hs * hs + vel.Z * vel.Z) / math.max(1, speed))
    local climb = math.max(-1, math.min(1, vel.Z / math.max(1, speed)))
    local wantLean = math.min(1, hs / math.max(1, speed)) * 62 - climb * 18
    local side = r * math.min(1, amt)
    lean = lerp(lean, wantLean, 1 - math.exp(-dt * 5))
    bank = lerp(bank, side * 18, 1 - math.exp(-dt * 4))
    bob = bob + dt
    local idle = 1 - math.min(1, amt * 1.5)
    local float = math.sin(bob * 2.6) * (6 + 10 * idle)
    local sway = math.sin(bob * 1.3) * 4 * idle

    local mesh = safe(function() return ch.Mesh end)
    if valid(mesh) and saved and saved.rot and saved.loc then
        local rot = { Pitch = saved.rot.Pitch + bank + sway * 0.5, Yaw = saved.rot.Yaw, Roll = saved.rot.Roll - lean + sway }
        safe(function() mesh:K2_SetRelativeRotation(rot, false, {}, false) end)
        safe(function() mesh:K2_SetRelativeLocation({ X = saved.loc.X, Y = saved.loc.Y, Z = saved.loc.Z + float + lean * 0.35 }, false, {}, false) end)
    end
end

function M.stop(ch)
    if on then restore(ch) end
    on = false
    saved = nil
end

return M
