local json = require("json")

local M = {}

local ORIGIN = { X = 0, Y = 0, Z = 2200000 }
local MARBLE_CLASS = "/Game/Blueprints/BP_Marble1"
local WOOD = "/Game/Fab/Bedroom1/Wooden_part_001"
local MARBLE_R = 778
local GEM_ODDS = {
    { "/Game/Assets/Materials/MI_GemBasic2", 0.386 },
    { "/Game/Assets/Materials/MI_GemBasic1", 0.077 },
    { "/Game/Assets/Materials/MI_GemBasic4", 0.2 },
    { "/Game/Assets/Materials/MI_GemBasic6", 0.133 },
    { "/Game/Assets/Materials/MI_GemBasic5", 0.111 },
    { "/Game/Assets/Materials/MI_GemBasic3", 0.093 },
}
local FEATHER = "/Game/Marble_Materials_4K/Materials/MI_Marble_01"
local CAPSULE = { 38, 38, 90 }
local BUDGET = 0.008

local ctx
local cur = nil
local pending = nil
local lastStatus = "none"
local lastError = ""
local hookOk = false

local D = math.pi / 180

local function safe(f, ...)
    local ok, a, b = pcall(f, ...)
    if ok then return a, b end
    return nil
end

local function valid(o)
    return o ~= nil and safe(function() return o:IsValid() end) == true
end

local function log(msg)
    local line = os.date("%H:%M:%S ") .. tostring(msg) .. "\n"
    local f = io.open(ctx.bridgeDir .. "/maps_log.txt", "a")
    if f then
        f:write(line)
        f:close()
    end
    local g = io.open(ctx.modDir .. "/../../../../../../hyperboi_log.txt", "a")
    if g then
        g:write(line)
        g:close()
    end
end

local function axesFromRot(r)
    local p, y, ro = (r[1] or 0) * D, (r[2] or 0) * D, (r[3] or 0) * D
    local SP, CP, SY, CY, SR, CR = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(ro), math.cos(ro)
    return {
        { CP * CY, CP * SY, SP },
        { SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP },
        { -(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP },
    }
end

local function rotFromAxes(A)
    local X, Y, Z = A[1], A[2], A[3]
    local pitch = math.atan(X[3], math.sqrt(X[1] * X[1] + X[2] * X[2]))
    local yaw = math.atan(X[2], X[1])
    local sy = { -math.sin(yaw), math.cos(yaw), 0 }
    local roll = math.atan(Z[1] * sy[1] + Z[2] * sy[2] + Z[3] * sy[3], Y[1] * sy[1] + Y[2] * sy[2] + Y[3] * sy[3])
    return { Pitch = pitch / D, Yaw = yaw / D, Roll = roll / D }
end

local function rotateVec(v, axis, ang)
    local l = math.sqrt(axis[1] ^ 2 + axis[2] ^ 2 + axis[3] ^ 2)
    if l == 0 then return v end
    local kx, ky, kz = axis[1] / l, axis[2] / l, axis[3] / l
    local c, s = math.cos(ang), math.sin(ang)
    local dot = kx * v[1] + ky * v[2] + kz * v[3]
    local cx, cy, cz = ky * v[3] - kz * v[2], kz * v[1] - kx * v[3], kx * v[2] - ky * v[1]
    return { v[1] * c + cx * s + kx * dot * (1 - c), v[2] * c + cy * s + ky * dot * (1 - c), v[3] * c + cz * s + kz * dot * (1 - c) }
end

local function smooth(f) return f * f * (3 - 2 * f) end

local function moveOffset(m, t)
    local pts = {}
    for i, p in ipairs(m.points) do pts[i] = p end
    if m.mode == "loop" then pts[#pts + 1] = m.points[1] end
    local n = #pts - 1
    if n < 1 then return { 0, 0, 0 } end
    local u = math.max(0, t - (m.delay or 0)) / m.duration
    if m.mode == "pingpong" then
        u = u % 2
        if u > 1 then u = 2 - u end
    elseif m.mode == "loop" then
        u = u % 1
    else
        u = math.min(1, u)
    end
    local x = u * n
    local i = math.min(n - 1, math.floor(x))
    local f = x - i
    if m.ease == "smooth" then f = smooth(f) end
    local a, b = pts[i + 1], pts[i + 2]
    return { a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f }
end

local function evalAnim(anim, t, pos, axes)
    local visible = true
    local rots = {}
    if anim.spin then rots[#rots + 1] = { anim.spin.axis, anim.spin.speed * t * D } end
    if anim.swing then rots[#rots + 1] = { anim.swing.axis, anim.swing.angle * math.sin(2 * math.pi * t / anim.swing.period) * D } end
    if #rots > 0 then
        local pv = anim.pivot
        local rel = { pos[1] - pv[1], pos[2] - pv[2], pos[3] - pv[3] }
        local ax = { axes[1], axes[2], axes[3] }
        for _, r in ipairs(rots) do
            rel = rotateVec(rel, r[1], r[2])
            ax = { rotateVec(ax[1], r[1], r[2]), rotateVec(ax[2], r[1], r[2]), rotateVec(ax[3], r[1], r[2]) }
        end
        pos = { pv[1] + rel[1], pv[2] + rel[2], pv[3] + rel[3] }
        axes = ax
    end
    if anim.move then
        local o = moveOffset(anim.move, t)
        pos = { pos[1] + o[1], pos[2] + o[2], pos[3] + o[3] }
    end
    if anim.blink and t > 0 then
        local c = anim.blink.on + anim.blink.off
        if c > 0 then visible = ((t + anim.blink.offset) % c) < anim.blink.on end
    end
    return pos, axes, visible
end

local function W(p)
    return { X = ORIGIN.X + p[1], Y = ORIGIN.Y + p[2], Z = ORIGIN.Z + p[3] }
end

local function hexColor(h, linear)
    h = tostring(h or "#ffffff"):gsub("#", "")
    local r = tonumber(h:sub(1, 2), 16) or 255
    local g = tonumber(h:sub(3, 4), 16) or 255
    local b = tonumber(h:sub(5, 6), 16) or 255
    if linear then
        local function lin(c)
            c = c / 255
            return c <= 0.04045 and c / 12.92 or ((c + 0.055) / 1.055) ^ 2.4
        end
        return { R = lin(r), G = lin(g), B = lin(b), A = 1 }
    end
    return { R = r, G = g, B = b, A = 255 }
end

local assetCache = {}
local function asset(path, suffix)
    local key = path .. (suffix or "")
    if assetCache[key] ~= nil then return assetCache[key] or nil end
    local base = path:match("([^/]+)$")
    local full = path .. "." .. base .. (suffix or "")
    local o = safe(function() return StaticFindObject(full) end)
    if not valid(o) then
        log("not loaded in this level, skipped: " .. full)
        assetCache[key] = false
        return nil
    end
    assetCache[key] = o
    return o
end

local CLASSES = {}
local function cls(path)
    if CLASSES[path] == nil then
        local c = StaticFindObject(path)
        CLASSES[path] = valid(c) and c or false
    end
    return CLASSES[path] or nil
end

local SHAPES = { cube = "/Engine/BasicShapes/Cube", cylinder = "/Engine/BasicShapes/Cylinder", sphere = "/Engine/BasicShapes/Sphere", cone = "/Engine/BasicShapes/Cone" }

local function quat(rot)
    local h = math.pi / 360
    local p, y, r = (rot.Pitch or 0) * h, (rot.Yaw or 0) * h, (rot.Roll or 0) * h
    local SP, CP, SY, CY, SR, CR = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
    return {
        X = CR * SP * SY - SR * CP * CY,
        Y = -CR * SP * CY - SR * CP * SY,
        Z = CR * CP * SY - SR * SP * CY,
        W = CR * CP * CY + SR * SP * SY,
    }
end

local GS = nil
local function spawnActor(world, class, loc, rot, scale)
    local who = ctx.getChar()
    if not valid(who) or not valid(class) then return nil end
    GS = valid(GS) and GS or StaticFindObject("/Script/Engine.Default__GameplayStatics")
    if not valid(GS) then return nil end
    local s = scale or { 1, 1, 1 }
    local xf = { Rotation = quat(rot or {}), Translation = { X = loc.X, Y = loc.Y, Z = loc.Z }, Scale3D = { X = s[1], Y = s[2], Z = s[3] } }
    local a = safe(function() return GS:BeginDeferredActorSpawnFromClass(who, class, xf, 1, nil, 1) end)
    if not valid(a) then return nil end
    safe(function() GS:FinishSpawningActor(a, xf, 1) end)
    if valid(a) then return a end
    return nil
end

local function meshComp(actor)
    local c = safe(function() return actor.StaticMeshComponent end)
    if valid(c) then return c end
    return nil
end

local function applyLook(actor, comp, part)
    if part.hidden then safe(function() actor:SetActorHiddenInGame(true) end) end
    if part.collide == false then safe(function() actor:SetActorEnableCollision(false) end) end
    if part.ice and valid(comp) then
        local pm = asset("/Game/Blueprints/PhysMat_Ice1")
        if pm then safe(function() comp:SetPhysMaterialOverride(pm) end) end
    end
end

local B64 = {}
do
    local chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    for i = 1, 64 do B64[chars:byte(i)] = i - 1 end
end

local function unb64(s)
    local out = {}
    local n = 0
    local char = string.char
    for i = 1, #s, 4 do
        local a, b, c, d = s:byte(i, i + 3)
        local va, vb, vc, vd = B64[a] or 0, B64[b] or 0, c and B64[c], d and B64[d]
        local x = (va << 18) | (vb << 12) | ((vc or 0) << 6) | (vd or 0)
        n = n + 1
        if vd then
            out[n] = char((x >> 16) & 255, (x >> 8) & 255, x & 255)
        elseif vc then
            out[n] = char((x >> 16) & 255, (x >> 8) & 255)
        else
            out[n] = char((x >> 16) & 255)
        end
    end
    return table.concat(out)
end

local function decodeSection(sec, two)
    local P = unb64(sec.p)
    local N = unb64(sec.n)
    local I = unb64(sec.i)
    local b = sec.b
    local sx, sy, sz = (b[4] - b[1]) / 65535, (b[5] - b[2]) / 65535, (b[6] - b[3]) / 65535
    local verts, norms, tris = {}, {}, {}
    local count = #P // 6
    local unpack = string.unpack
    for k = 0, count - 1 do
        local x, y, z = unpack("<I2I2I2", P, k * 6 + 1)
        local nx, ny, nz = unpack("<i1i1i1", N, k * 3 + 1)
        verts[k + 1] = { X = b[1] + x * sx, Y = b[2] + y * sy, Z = b[3] + z * sz }
        norms[k + 1] = { X = nx / 127, Y = ny / 127, Z = nz / 127 }
    end
    local tc = #I // 2
    for k = 0, tc - 1 do
        tris[k + 1] = unpack("<I2", I, k * 2 + 1)
    end
    if two then
        for k = 1, count do
            local v, nn = verts[k], norms[k]
            verts[count + k] = { X = v.X, Y = v.Y, Z = v.Z }
            norms[count + k] = { X = -nn.X, Y = -nn.Y, Z = -nn.Z }
        end
        for k = 1, tc, 3 do
            tris[tc + k] = tris[k] + count
            tris[tc + k + 1] = tris[k + 2] + count
            tris[tc + k + 2] = tris[k + 1] + count
        end
    end
    return verts, tris, norms
end

local IDENTITY = { Translation = { X = 0, Y = 0, Z = 0 }, Rotation = { X = 0, Y = 0, Z = 0, W = 1 }, Scale3D = { X = 1, Y = 1, Z = 1 } }

local function spawnPart(world, part)
    if part.fallbackFor and not (cur and cur.meshDead and cur.meshDead[part.fallbackFor]) then return "skip" end
    local loc = W(part.pos)
    local r = part.rot or { 0, 0, 0 }
    local rot = { Pitch = r[1], Yaw = r[2], Roll = r[3] }
    local s = part.scale or { 1, 1, 1 }
    local actor
    if part.kind == "shape" or part.kind == "mesh" then
        local smaClass = cls("/Script/Engine.StaticMeshActor")
        local mesh = part.kind == "shape" and asset(SHAPES[part.shape] or SHAPES.cube) or asset(part.path)
        if not smaClass or not mesh then return nil end
        actor = spawnActor(world, smaClass, loc, rot)
        if not actor then return nil end
        local comp = meshComp(actor)
        if comp then
            safe(function() comp:SetMobility(2) end)
            safe(function() comp:SetStaticMesh(mesh) end)
            local wood = part.mat == "wood" and asset(WOOD)
            if wood then
                safe(function() comp:SetMaterial(0, wood) end)
            elseif part.kind == "shape" and part.color then
                local base = asset("/Engine/BasicShapes/BasicShapeMaterial")
                if base then
                    local mi = safe(function() return comp:CreateDynamicMaterialInstance(0, base, FName("None")) end)
                    if valid(mi) then safe(function() mi:SetVectorParameterValue(FName("Color"), hexColor(part.color, true)) end) end
                end
            end
        end
        applyLook(actor, comp, part)
    elseif part.kind == "procmesh" then
        if part.group and cur and cur.meshDead and cur.meshDead[part.group] then return nil end
        local smaClass = cls("/Script/Engine.StaticMeshActor")
        local pmc = cls("/Script/ProceduralMeshComponent.ProceduralMeshComponent")
        local fail = function(why)
            if cur then
                cur.meshDead = cur.meshDead or {}
                if part.group then cur.meshDead[part.group] = true end
            end
            log("real shape failed: " .. why .. (part.group and ", using blocks instead" or ""))
            if actor then safe(function() actor:K2_DestroyActor() end) end
            return nil
        end
        if not smaClass then return fail("no StaticMeshActor class") end
        if not pmc then return fail("the game has no ProceduralMeshComponent class") end
        if not part.sec then return fail("no mesh data in the map file") end
        actor = spawnActor(world, smaClass, loc, rot)
        if not actor then return fail("couldn't spawn the holder actor") end
        local root = meshComp(actor)
        if root then safe(function() root:SetMobility(2) end) end
        local okc, comp = pcall(function() return actor:AddComponentByClass(pmc, false, IDENTITY, false) end)
        if not okc then return fail("AddComponentByClass errored: " .. tostring(comp)) end
        if not valid(comp) then return fail("AddComponentByClass gave nothing back") end
        safe(function() comp:SetMobility(2) end)
        local ok, v, t, n = pcall(decodeSection, part.sec, part.two)
        if not ok then return fail("bad mesh data: " .. tostring(v)) end
        local col = part.collide ~= false
        safe(function() comp.bUseAsyncCooking = false end)
        safe(function() comp.bUseComplexAsSimpleCollision = true end)
        if col then
            safe(function() comp:SetCollisionProfileName(FName("BlockAll"), false) end)
            safe(function() comp:SetCollisionEnabled(3) end)
        end
        local okm, err = pcall(function() comp:CreateMeshSection(0, v, t, n, nil, nil, nil, col) end)
        if not okm then
            local ok2, err2 = pcall(function() comp:CreateMeshSection_LinearColor(0, v, t, n, nil, nil, nil, nil, nil, nil, col, false) end)
            if not ok2 then return fail("CreateMeshSection errored: " .. tostring(err) .. " / " .. tostring(err2)) end
        end
        local secs = safe(function() return comp:GetNumSections() end)
        if secs ~= nil and secs < 1 then return fail("mesh section came out empty (" .. #v .. " verts, " .. #t .. " indices)") end
        if not cur.meshLogged then
            cur.meshLogged = true
            log(("real shape ok: %d verts, %d indices, sections %s"):format(#v, #t, tostring(secs)))
        end
        if col then
            safe(function() comp:SetCollisionProfileName(FName("BlockAll"), true) end)
            safe(function() comp:SetCollisionEnabled(3) end)
            safe(function() comp:SetCollisionResponseToAllChannels(2) end)
            safe(function() comp:RecreatePhysicsState() end)
            if not cur.colLogged then
                cur.colLogged = true
                local ce = safe(function() return comp:GetCollisionEnabled() end)
                local bs = safe(function() return comp.ProcMeshBodySetup end)
                log(("real shape collision: enabled %s, body %s"):format(tostring(ce), tostring(valid(bs))))
            end
        else
            safe(function() comp:SetCollisionEnabled(0) end)
        end
        local base = asset("/Engine/BasicShapes/BasicShapeMaterial")
        if base then
            local mi = safe(function() return comp:CreateDynamicMaterialInstance(0, base, FName("None")) end)
            if valid(mi) then safe(function() mi:SetVectorParameterValue(FName("Color"), hexColor(part.color or "#9a9a96", true)) end) end
        end
        applyLook(actor, comp, part)
    elseif part.kind == "bp" then
        local c = asset(part.path, "_C")
        if not c then return nil end
        actor = spawnActor(world, c, loc, rot)
        if not actor then return nil end
        applyLook(actor, nil, part)
    elseif part.kind == "skel" then
        local c = cls("/Script/Engine.SkeletalMeshActor")
        local mesh = asset(part.path)
        if not c or not mesh then return nil end
        actor = spawnActor(world, c, loc, rot)
        if not actor then return nil end
        local comp = safe(function() return actor.SkeletalMeshComponent end)
        if valid(comp) then
            safe(function() comp:SetMobility(2) end)
            if not safe(function() comp:SetSkeletalMeshAsset(mesh) return true end) then
                safe(function() comp:SetSkeletalMesh(mesh, true) end)
            end
        end
    elseif part.kind == "text" then
        local c = cls("/Script/Engine.TextRenderActor")
        if not c then return nil end
        actor = spawnActor(world, c, loc, rot)
        if not actor then return nil end
        local comp = safe(function() return actor.TextRender end)
        if valid(comp) then
            safe(function() comp:SetMobility(2) end)
            safe(function() comp:K2_SetText(FText(part.text or "")) end)
            safe(function() comp:SetWorldSize(part.size or 100) end)
            safe(function() comp:SetHorizontalAlignment(1) end)
            safe(function() comp:SetVerticalAlignment(1) end)
            safe(function() comp:SetTextRenderColor(hexColor(part.color, false)) end)
        end
        s = { 1, 1, 1 }
    elseif part.kind == "light" then
        local c = cls("/Script/Engine.PointLight")
        if not c then return nil end
        actor = spawnActor(world, c, loc, rot)
        if not actor then return nil end
        local comp = safe(function() return actor.PointLightComponent end)
        if valid(comp) then
            safe(function() comp:SetMobility(2) end)
            safe(function() comp:SetIntensity(part.intensity or 8000) end)
            safe(function() comp:SetAttenuationRadius(part.radius or 2000) end)
            safe(function() comp:SetLightColor(hexColor(part.color, true), true) end)
        end
        s = { 1, 1, 1 }
    end
    if not actor then return nil end
    safe(function() actor:SetActorScale3D({ X = s[1], Y = s[2], Z = s[3] }) end)
    return actor
end

local function randomGem()
    local r = math.random()
    local acc = 0
    for _, g in ipairs(GEM_ODDS) do
        acc = acc + g[2]
        if r < acc then return g[1] end
    end
    return GEM_ODDS[1][1]
end

local function marbleComp(a)
    local c = safe(function() return a.StaticMesh end)
    if valid(c) then return c end
    return nil
end

local function addr(o)
    return o and safe(function() return o:GetAddress() end) or nil
end

local function spawnMarble(world, pos, opts)
    local c = asset(MARBLE_CLASS, "_C")
    if not c then return nil end
    local a = spawnActor(world, c, W(pos), { Pitch = 0, Yaw = opts.yaw or 0, Roll = 0 })
    if not a then return nil end
    local comp = marbleComp(a)
    local matPath = opts.mat or randomGem()
    local feather = opts.feather or matPath == FEATHER
    if comp then
        local m = asset(matPath)
        if m then safe(function() comp:SetMaterial(0, m) end) end
        safe(function() a.IsFeather = feather end)
        if feather then safe(function() comp:SetMassOverrideInKg(FName("None"), 38, true) end) end
        if opts.mode == "float" or opts.mode == "drift" then
            safe(function() comp:SetEnableGravity(false) end)
            safe(function() comp:SetLinearDamping(opts.mode == "float" and 0.35 or 0.02) end)
            safe(function() comp:SetAngularDamping(0.6) end)
        end
        if opts.vel then
            local v = opts.vel
            safe(function() comp:SetPhysicsLinearVelocity({ X = v[1], Y = v[2], Z = v[3] }, false, FName("None")) end)
        end
    end
    safe(function() a.NotGroundedTime = 1e12 end)
    local m = { actor = a, comp = comp, home = pos, mode = opts.mode, anim = opts.anim, axes = opts.axes, addr = addr(a) }
    if comp then
        safe(function() comp:SetSimulatePhysics(true) end)
        safe(function() comp:SetEnableGravity(m.mode ~= "float" and m.mode ~= "drift") end)
    end
    return m
end

local liveCache = {}
local function liveSet(clsName)
    local set = liveCache[clsName]
    if set then return set end
    set = {}
    local all = safe(function() return FindAllOf(clsName) end)
    if all then
        for _, o in ipairs(all) do
            local a = safe(function() return o:GetAddress() end)
            if a then set[a] = true end
        end
    end
    liveCache[clsName] = set
    return set
end

local function alive(rec, clsName)
    if not rec or not rec.addr then return false end
    if not liveSet(clsName or rec.cls or "BP_Marble1_C")[rec.addr] then return false end
    return valid(rec.actor)
end

local function enforce(m)
    if not m or not m.comp or not alive(m) then return end
    local c = m.comp
    if safe(function() return c:IsSimulatingPhysics(FName("None")) end) == false then
        safe(function() c:SetSimulatePhysics(true) end)
        safe(function() c:SetCollisionResponseToChannel(5, 2) end)
        safe(function() c:SetActive(true, false) end)
        safe(function() m.actor:SetActorHiddenInGame(false) end)
        safe(function() c:SetVisibility(true, true) end)
    end
    safe(function() c:SetEnableGravity(m.mode ~= "float" and m.mode ~= "drift") end)
    safe(function() m.actor.possessable = true end)
end

local function killMarble(m)
    if m and alive(m) then safe(function() m.actor:K2_DestroyActor() end) end
end

local function readIndex()
    local list = {}
    local f = io.open(ctx.modDir .. "/maps/index.txt", "r")
    if not f then return list end
    for line in f:lines() do
        local file, name, author, diff = line:match("^(.-)|(.-)|(.-)|(.-)$")
        if file and file ~= "" then list[#list + 1] = { file = file, name = name, author = author, difficulty = diff } end
    end
    f:close()
    return list
end
M.readIndex = readIndex

local function nextMap(file)
    local list = readIndex()
    for i, m in ipairs(list) do
        if m.file == file then return list[i + 1] end
    end
    return nil
end

local function now(world)
    local gs = valid(GS) and GS or StaticFindObject("/Script/Engine.Default__GameplayStatics")
    local t = gs and safe(function() return gs:GetTimeSeconds(world) end)
    return t or os.clock()
end

local function charPos(ch)
    local v = safe(function() return ch:K2_GetActorLocation() end)
    if not v then return nil end
    return { v.X - ORIGIN.X, v.Y - ORIGIN.Y, v.Z - ORIGIN.Z }
end

local function teleport(ch, pos, yaw, keepVel)
    local cmc = ctx.getCmc()
    safe(function() ch:K2_SetActorLocation(W({ pos[1], pos[2], pos[3] + CAPSULE[3] + 10 }), false, {}, true) end)
    if not keepVel and valid(cmc) then safe(function() cmc.Velocity = { X = 0, Y = 0, Z = 0 } end) end
    if yaw then
        local ctrl = safe(function() return ch.Controller end)
        if valid(ctrl) then safe(function() ctrl:SetControlRotation({ Pitch = -10, Yaw = yaw, Roll = 0 }) end) end
    end
end

local function clearLoading()
    if not cur or not cur.loadText then return end
    for _, a in ipairs(cur.loadText) do
        if valid(a) then safe(function() a:K2_DestroyActor() end) end
    end
    cur.loadText = nil
end

local function textActor(pos, yaw, text, size, color)
    local c = cls("/Script/Engine.TextRenderActor")
    if not c then return nil end
    local a = spawnActor(cur.worldObj, c, W(pos), { Pitch = 0, Yaw = yaw, Roll = 0 })
    if not a then return nil end
    local comp = safe(function() return a.TextRender end)
    if valid(comp) then
        safe(function() comp:SetMobility(2) end)
        safe(function() comp:K2_SetText(FText(text)) end)
        safe(function() comp:SetWorldSize(size) end)
        safe(function() comp:SetHorizontalAlignment(1) end)
        safe(function() comp:SetVerticalAlignment(1) end)
        safe(function() comp:SetTextRenderColor(color) end)
    end
    return a
end

local function showLoading()
    if not cur or not cur.holdAt then return end
    local total = cur.loadTotal or 1
    local left = #cur.queue + #cur.mqueue
    local pct = math.floor((1 - left / math.max(1, total)) * 100 + 0.5)
    local label = ("%d%%   %d / %d"):format(pct, total - left, total)
    if cur.loadText and cur.loadLabel == label then return end
    local y = (cur.spawn.yaw or 0) * D
    local f = { math.cos(y), math.sin(y) }
    local h = cur.holdAt
    local at = { h[1] + f[1] * 2600, h[2] + f[2] * 2600, h[3] + 120 }
    local face = (cur.spawn.yaw or 0) + 180
    if not cur.loadText then
        cur.loadText = {}
        cur.loadText[1] = textActor({ at[1], at[2], at[3] + 260 }, face, "LOADING", 260, { R = 255, G = 255, B = 255, A = 255 })
        cur.loadText[2] = textActor({ at[1], at[2], at[3] + 20 }, face, tostring(cur.name), 150, { R = 95, G = 200, B = 255, A = 255 })
        cur.loadText[3] = textActor({ at[1], at[2], at[3] - 180 }, face, label, 110, { R = 200, G = 196, B = 255, A = 255 })
    else
        local a = cur.loadText[3]
        if valid(a) then
            local comp = safe(function() return a.TextRender end)
            if valid(comp) then safe(function() comp:K2_SetText(FText(label)) end) end
        end
    end
    cur.loadLabel = label
end

local function setMsg(text)
    if cur then
        cur.msg = text
        cur.msgAt = os.clock()
    end
end

local function restoreMovement()
    if not cur or not cur.orig then return end
    local cmc = ctx.getCmc()
    if valid(cmc) then
        for k, v in pairs(cur.orig) do safe(function() cmc[k] = v end) end
    end
    local ws = FindAllOf("WorldSettings")
    if ws then for _, w in ipairs(ws) do safe(function() w.TimeDilation = 1 end) end end
end

local function applyRules()
    local cmc = ctx.getCmc()
    if not valid(cmc) then return end
    cur.orig = {}
    for _, k in ipairs({ "GravityScale", "MaxWalkSpeed", "JumpZVelocity", "MaxAcceleration" }) do
        cur.orig[k] = safe(function() return cmc[k] end)
    end
    local r = cur.rules
    cur.baseGravity = (cur.orig.GravityScale or 1) * (r.gravity or 1)
    safe(function() cmc.GravityScale = cur.baseGravity end)
    if r.speed and r.speed ~= 1 and cur.orig.MaxWalkSpeed then
        safe(function() cmc.MaxWalkSpeed = cur.orig.MaxWalkSpeed * r.speed end)
        safe(function() cmc.MaxAcceleration = (cur.orig.MaxAcceleration or 2048) * r.speed end)
    end
    if r.jump and r.jump ~= 1 and cur.orig.JumpZVelocity then safe(function() cmc.JumpZVelocity = cur.orig.JumpZVelocity * r.jump end) end
end

function M.unload(silent)
    if not cur then return end
    liveCache = {}
    if cur.world ~= ctx.worldName() then
        cur = nil
        lastStatus = "none"
        return
    end
    for _, sp in ipairs(cur.spawned) do
        if alive(sp) then safe(function() sp.actor:K2_DestroyActor() end) end
    end
    for _, m in ipairs(cur.marbles) do killMarble(m) end
    for _, sp in ipairs(cur.spawners) do for _, m in ipairs(sp.live) do killMarble(m) end end
    killMarble(cur.startMarble)
    if valid(cur.finishText) then safe(function() cur.finishText:K2_DestroyActor() end) end
    clearLoading()
    restoreMovement()
    ctx.setKillboxes(false)
    local ch = ctx.getChar()
    if valid(ch) and cur.returnTo and cur.world == ctx.worldName() then
        safe(function() ch:K2_SetActorLocation(cur.returnTo, false, {}, true) end)
        local cmc = ctx.getCmc()
        if valid(cmc) then safe(function() cmc.Velocity = { X = 0, Y = 0, Z = 0 } end) end
    end
    if not silent then log("unloaded " .. tostring(cur.name)) end
    cur = nil
    lastStatus = "none"
end

function M.load(file)
    M.unload(true)
    lastError = ""
    local path = ctx.modDir .. "/maps/" .. file
    local f = io.open(path, "r")
    if not f then
        lastError = "Couldn't open " .. file
        lastStatus = "error"
        return false
    end
    local text = f:read("*a")
    f:close()
    local data, err = json.decode(text)
    if not data or data.format ~= "builderballin" then
        lastError = "That isn't a Builderballin map (" .. tostring(err or "wrong format") .. ")"
        lastStatus = "error"
        return false
    end
    if not data.build then
        lastError = "Export the map again from Builderballin, it's missing its build data"
        lastStatus = "error"
        return false
    end
    local ch = ctx.getChar()
    if not valid(ch) then
        pending = file
        lastStatus = "waiting"
        return true
    end
    local world = safe(function() return ch:GetWorld() end)
    local b = data.build
    local here = safe(function() return ch:K2_GetActorLocation() end)
    cur = {
        file = file,
        name = (data.meta and data.meta.name) or file,
        meta = data.meta or {},
        rules = data.rules or {},
        build = b,
        world = ctx.worldName(),
        worldObj = world,
        returnTo = here and { X = here.X, Y = here.Y, Z = here.Z } or nil,
        queue = {},
        spawned = {},
        animated = {},
        zones = {},
        spawn = b.spawn or { pos = { 0, 0, 0 }, yaw = 0 },
        respawnAt = nil,
        cps = {},
        cpTotal = b.checkpoints or 0,
        deaths = 0,
        runStart = nil,
        runTime = 0,
        finished = nil,
        best = nil,
        msg = nil,
        t0 = now(world),
        triggers = {},
        marbles = {},
        mqueue = {},
        spawners = {},
        startMarble = nil,
        frame = 0,
    }
    for _, m in ipairs(b.marbles or {}) do cur.mqueue[#cur.mqueue + 1] = m end
    for _, sp in ipairs(b.spawners or {}) do
        sp.axes = axesFromRot(sp.rot or { 0, 0, 0 })
        sp.timer = 0
        sp.live = {}
        cur.spawners[#cur.spawners + 1] = sp
    end
    local parts = b.parts or {}
    for k = #parts, 1, -1 do cur.queue[#cur.queue + 1] = parts[k] end
    for _, z in ipairs(b.zones or {}) do
        z.axes = axesFromRot(z.rot or { 0, 0, 0 })
        z.inside = false
        z.cur = z.pos
        z.curAxes = z.axes
        cur.zones[#cur.zones + 1] = z
    end
    lastStatus = "loading"
    ctx.setKillboxes(true)
    cur.loadTotal = #cur.queue + #cur.mqueue
    local sp = cur.spawn.pos or { 0, 0, 0 }
    cur.holdAt = { sp[1], sp[2], sp[3] + 9000 }
    cur.hold = W(cur.holdAt)
    cur.hold.Z = cur.hold.Z + CAPSULE[3] + 10
    teleport(ch, cur.holdAt, cur.spawn.yaw or 0, false)
    log("loading " .. cur.name .. " with " .. #cur.queue .. " parts, " .. #cur.mqueue .. " marbles and " .. #cur.spawners .. " spawners")
    return true
end

local function dropAt(ch, pos, yaw, fresh)
    local sp = cur.build.spawn or {}
    killMarble(cur.startMarble)
    cur.startMarble = nil
    local world = cur.worldObj
    if fresh ~= false then
        local y = (yaw or 0) * D
        local lo, hi = sp.speedMin or sp.speed or 10000, sp.speedMax or sp.speed or 10000
        if lo > hi then lo, hi = hi, lo end
        local speed = lo + math.random() * (hi - lo)
        local mat = nil
        if sp.gems and #sp.gems > 0 then mat = sp.gems[math.random(#sp.gems)] end
        cur.startMarble = spawnMarble(world, { pos[1], pos[2], pos[3] + MARBLE_R }, { mat = mat, mode = sp.mode or "roll", yaw = yaw, vel = { math.cos(y) * speed, math.sin(y) * speed, 0 } })
    end
    teleport(ch, { pos[1], pos[2], pos[3] + MARBLE_R * 2 + 60 }, yaw, false)
    safe(function()
        local og = ch.HealthOG
        if og and og > 0 then ch.Health = og end
    end)
end

function M.restart()
    if not cur then return end
    local ch = ctx.getChar()
    if not valid(ch) then return end
    cur.cps = {}
    cur.respawnAt = nil
    cur.runStart = nil
    cur.runTime = 0
    cur.finished = nil
    cur.armed = true
    for _, z in ipairs(cur.zones) do z.fired = false end
    cur.triggers = {}
    cur.t0 = now(cur.worldObj)
    cur.finishAt = nil
    if valid(cur.finishText) then safe(function() cur.finishText:K2_DestroyActor() end) end
    cur.finishText = nil
    dropAt(ch, cur.spawn.pos, cur.spawn.yaw)
end

local function respawn(ch, reason)
    cur.deaths = cur.deaths + 1
    local at = cur.respawnAt or { pos = cur.spawn.pos, yaw = cur.spawn.yaw }
    dropAt(ch, at.pos, at.yaw)
    if not cur.respawnAt then
        cur.runStart = nil
        cur.runTime = 0
        cur.armed = true
    end
    local cmc = ctx.getCmc()
    if valid(cmc) and cur.baseGravity then safe(function() cmc.GravityScale = cur.baseGravity end) end
    for _, z in ipairs(cur.zones) do z.inside = false end
end

local function inZone(z, p)
    local d = { p[1] - z.cur[1], p[2] - z.cur[2], p[3] - z.cur[3] }
    if z.sphere then return d[1] * d[1] + d[2] * d[2] + d[3] * d[3] <= (z.sphere + 120) ^ 2 end
    local A = z.curAxes
    for k = 1, 3 do
        local l = d[1] * A[k][1] + d[2] * A[k][2] + d[3] * A[k][3]
        if math.abs(l) > z.ext[k] + CAPSULE[k] * 0.5 then return false end
    end
    return true
end

local function launch(ch, v, xy, z)
    safe(function() ch:LaunchCharacter({ X = v[1], Y = v[2], Z = v[3] }, xy, z) end)
end

local function showFinish(ch, z)
    local c = cls("/Script/Engine.TextRenderActor")
    local here = charPos(ch)
    if not c or not here then return end
    local at = { z.cur[1], z.cur[2], z.cur[3] + z.ext[3] * 0.6 }
    local yaw = math.atan(here[2] - at[2], here[1] - at[1]) / D
    local a = spawnActor(cur.worldObj, c, W(at), { Pitch = 0, Yaw = yaw, Roll = 0 })
    if not a then return end
    local comp = safe(function() return a.TextRender end)
    if valid(comp) then
        safe(function() comp:SetMobility(2) end)
        safe(function() comp:K2_SetText(FText(("FINISHED  %.2f s"):format(cur.finished))) end)
        safe(function() comp:SetWorldSize(math.max(800, z.ext[3] * 0.25)) end)
        safe(function() comp:SetHorizontalAlignment(1) end)
        safe(function() comp:SetVerticalAlignment(1) end)
        safe(function() comp:SetTextRenderColor({ R = 95, G = 200, B = 255, A = 255 }) end)
    end
    if valid(cur.finishText) then safe(function() cur.finishText:K2_DestroyActor() end) end
    cur.finishText = a
end

local function zoneEnter(z, ch, cmc)
    local t = z.type
    local P = z.params or {}
    if t == "kill" then
        respawn(ch, "kill")
    elseif t == "checkpoint" then
        if not cur.cps[z.id] then
            cur.cps[z.id] = true
            local n = 0
            for _ in pairs(cur.cps) do n = n + 1 end
            setMsg("Checkpoint " .. n .. "/" .. cur.cpTotal)
        end
        cur.respawnAt = { pos = { z.cur[1], z.cur[2], z.cur[3] - z.ext[3] }, yaw = (z.rot and z.rot[2]) or cur.spawn.yaw }
    elseif t == "finish" then
        local n = 0
        for _ in pairs(cur.cps) do n = n + 1 end
        if cur.rules.needCheckpoints and n < cur.cpTotal then
            setMsg("Touch every checkpoint first (" .. n .. "/" .. cur.cpTotal .. ")")
        elseif not cur.finished then
            cur.finished = now(cur.worldObj) - (cur.runStart or cur.t0)
            cur.runTime = cur.finished
            cur.finishAt = now(cur.worldObj)
            if not cur.best or cur.finished < cur.best then cur.best = cur.finished end
            setMsg(("Finished in %.2f s"):format(cur.finished))
            log(("finish %s %.3f"):format(cur.name, cur.finished))
            showFinish(ch, z)
        end
    elseif t == "bounce" then
        launch(ch, { 0, 0, P.power or 2200 }, not P.keep, true)
    elseif t == "boost" then
        local f = z.curAxes[1]
        local pw = P.power or 3500
        launch(ch, { f[1] * pw, f[2] * pw, (P.lift or 0) + f[3] * pw }, true, (P.lift or 0) > 0)
    elseif t == "speed" then
        if valid(cmc) then
            local v = safe(function() return cmc.Velocity end)
            if v then
                local m = P.mult or 1.5
                safe(function() cmc.Velocity = { X = v.X * m, Y = v.Y * m, Z = v.Z } end)
            end
        end
    elseif t == "gravity" then
        if valid(cmc) then safe(function() cmc.GravityScale = (cur.baseGravity or 1) * (P.scale or 0.3) end) end
    elseif t == "slowmo" then
        local ws = FindAllOf("WorldSettings")
        if ws then for _, w in ipairs(ws) do safe(function() w.TimeDilation = P.speed or 0.4 end) end end
    elseif t == "teleport" then
        if z.to then
            local v = valid(cmc) and safe(function() return cmc.Velocity end)
            teleport(ch, z.to.pos, z.to.yaw, P.keep)
            if P.keep and v then
                local sp = math.sqrt(v.X * v.X + v.Y * v.Y)
                local yaw = (z.to.yaw or 0) * D
                safe(function() cmc.Velocity = { X = math.cos(yaw) * sp, Y = math.sin(yaw) * sp, Z = v.Z } end)
            end
        end
    elseif t == "trigger" then
        local chn = tostring(P.channel or "A")
        if not (P.once and z.fired) then
            z.fired = true
            cur.triggers[chn] = now(cur.worldObj) - cur.t0
        end
    elseif t == "message" then
        setMsg(P.text or "")
    end
end

local function zoneExit(z, ch, cmc)
    if z.type == "gravity" then
        if valid(cmc) and cur.baseGravity then safe(function() cmc.GravityScale = cur.baseGravity end) end
    elseif z.type == "slowmo" then
        local ws = FindAllOf("WorldSettings")
        if ws then for _, w in ipairs(ws) do safe(function() w.TimeDilation = 1 end) end end
    end
end

local function animTime(anim, t)
    if anim.start == "trigger" then
        local at = cur.triggers[tostring(anim.channel or "A")]
        if not at then return 0 end
        return math.max(0, t - at)
    end
    return t
end

local function spawnBatch(world)
    local n = 0
    if #cur.queue == 0 and #cur.mqueue > 0 then
        while #cur.mqueue > 0 and n < 5 do
            local m = table.remove(cur.mqueue, 1)
            local vel = m.vel
            if m.dir and (m.pushMax or 0) > 0 then
                local sv = (m.pushMin or 0) + math.random() * ((m.pushMax or 0) - (m.pushMin or 0))
                vel = { m.dir[1] * sv, m.dir[2] * sv, m.dir[3] * sv }
            end
            local mb = spawnMarble(world, m.pos, { mat = m.mat, feather = m.feather, mode = m.mode, vel = vel, anim = m.anim, axes = axesFromRot({ 0, 0, 0 }) })
            if mb then cur.marbles[#cur.marbles + 1] = mb else cur.failed = (cur.failed or 0) + 1 end
            n = n + 1
        end
        if #cur.mqueue > 0 then return end
    end
    local started = os.clock()
    while #cur.queue > 0 and (n < 4 or os.clock() - started < BUDGET) do
        local part = table.remove(cur.queue)
        local actor = spawnPart(world, part)
        if actor == "skip" then
            actor = nil
        elseif actor then
            local sp = { actor = actor, part = part, axes = axesFromRot(part.rot or { 0, 0, 0 }), addr = addr(actor), cls = safe(function() return actor:GetClass():GetFName():ToString() end) }
            cur.spawned[#cur.spawned + 1] = sp
            if part.anim then cur.animated[#cur.animated + 1] = sp end
        else
            cur.failed = (cur.failed or 0) + 1
        end
        n = n + 1
    end
    if #cur.queue == 0 and #cur.mqueue > 0 then return end
    if #cur.queue == 0 then
        lastStatus = "loaded"
        log(("loaded %s: %d spawned, %d failed"):format(cur.name, #cur.spawned, cur.failed or 0))
        clearLoading()
        cur.hold = nil
        local ch = ctx.getChar()
        applyRules()
        if valid(ch) then dropAt(ch, cur.spawn.pos, cur.spawn.yaw) end
        cur.armed = true
        cur.t0 = now(world)
    end
end

function M.tick()
    liveCache = {}
    local ch = ctx.getChar()
    if pending and valid(ch) then
        local f = pending
        pending = nil
        M.load(f)
    end
    if not cur then return end
    if cur.world ~= ctx.worldName() then
        log("world changed, map dropped")
        cur = nil
        lastStatus = "none"
        return
    end
    if not valid(ch) then return end
    local world = cur.worldObj
    if #cur.queue > 0 or #cur.mqueue > 0 then
        if cur.hold then
            safe(function() ch:K2_SetActorLocation(cur.hold, false, {}, true) end)
            local cm = ctx.getCmc()
            if valid(cm) then safe(function() cm.Velocity = { X = 0, Y = 0, Z = 0 } end) end
        end
        showLoading()
        if now(world) - cur.t0 < 1.0 then return end
        spawnBatch(world)
        if cur and cur.loadText then showLoading() end
        return
    end
    cur.frame = cur.frame + 1
    local t = now(world) - cur.t0
    for _, sp in ipairs(cur.animated) do
        local a = sp.part.anim
        local at = animTime(a, t)
        local pos, axes, vis = evalAnim(a, at, sp.part.pos, sp.axes)
        if alive(sp) then
            safe(function() sp.actor:K2_SetActorLocationAndRotation(W(pos), rotFromAxes(axes), false, {}, true) end)
            if a.blink and vis ~= sp.vis then
                sp.vis = vis
                safe(function() sp.actor:SetActorHiddenInGame((not vis) or (sp.part.hidden == true)) end)
                safe(function() sp.actor:SetActorEnableCollision(vis and sp.part.collide ~= false) end)
            end
        end
    end
    M.tickMarbles(ch, t)
    local p = charPos(ch)
    if not p then return end
    local cmc = ctx.getCmc()
    if cur.armed and not cur.runStart then
        local sp = cur.spawn.pos
        local dx, dy = p[1] - sp[1], p[2] - sp[2]
        if dx * dx + dy * dy > 1500 * 1500 then
            cur.runStart = now(world)
            cur.armed = false
        end
    end
    if cur.finished and cur.finishAt and now(world) - cur.finishAt > 3 then
        cur.finishAt = nil
        if valid(cur.finishText) then safe(function() cur.finishText:K2_DestroyActor() end) end
        cur.finishText = nil
        local nxt = nextMap(cur.file)
        if nxt then
            local back = cur.returnTo
            log("on to the next map: " .. tostring(nxt.name ~= "" and nxt.name or nxt.file))
            cur.returnTo = nil
            M.load(nxt.file)
            if cur then
                cur.returnTo = back
                cur.msg = "Next up: " .. tostring(nxt.name ~= "" and nxt.name or nxt.file)
                cur.msgAt = os.clock()
            end
            return
        end
        log("that was the last custom map, on to the next level")
        M.unload(true)
        local c2 = ctx.getChar()
        if valid(c2) then safe(function() c2:NextLevel() end) end
        return
    end
    if cur.runStart and not cur.finished then cur.runTime = now(world) - cur.runStart end
    local lim = cur.rules.timeLimit or 0
    if lim > 0 and cur.runStart and not cur.finished and cur.runTime > lim then
        setMsg("Out of time")
        cur.respawnAt = nil
        M.restart()
        return
    end
    local hp = safe(function() return ch.Health end)
    if p[3] < (cur.rules.killHeight or -60000) or (hp and hp <= 0) then
        respawn(ch, "fall")
        return
    end
    for _, z in ipairs(cur.zones) do
        if z.anim then
            local pos, axes = evalAnim(z.anim, animTime(z.anim, t), z.pos, z.axes)
            z.cur, z.curAxes = pos, axes
        end
        local inside = inZone(z, p)
        if inside and not z.inside then
            z.inside = true
            zoneEnter(z, ch, cmc)
            if not cur then return end
        elseif not inside and z.inside then
            z.inside = false
            zoneExit(z, ch, cmc)
        end
        if inside and z.type == "wind" then
            local f = z.curAxes[1]
            local force = (z.params and z.params.force) or 900
            local dt = 1 / 60
            if valid(cmc) then
                local v = safe(function() return cmc.Velocity end)
                if v then safe(function() cmc.Velocity = { X = v.X + f[1] * force * dt, Y = v.Y + f[2] * force * dt, Z = v.Z + f[3] * force * dt } end) end
            end
        end
    end
end

local function rideAddr(ch)
    local lm = safe(function() return ch.LockedOnMarble end)
    if lm and valid(lm) then return addr(lm) end
    return nil
end

function M.tickMarbles(ch, t)
    local world = cur.worldObj
    local dt = math.max(0, math.min(0.1, t - (cur.lastT or t)))
    cur.lastT = t
    local riding = rideAddr(ch)
    local refresh = cur.frame % 20 == 0
    local check = cur.frame % 3 == 0
    for _, m in ipairs(cur.marbles) do
        if alive(m) and m.comp then
            if m.anim then
                local pos = evalAnim(m.anim, animTime(m.anim, t), m.home, m.axes)
                safe(function() m.comp:K2_SetWorldLocation(W(pos), false, {}, true) end)
                safe(function() m.comp:SetPhysicsLinearVelocity({ X = 0, Y = 0, Z = 0 }, false, FName("None")) end)
            elseif m.mode == "float" and check and m.addr ~= riding then
                local l = safe(function() return m.comp:K2_GetComponentLocation() end)
                if l then
                    local dx, dy, dz = ORIGIN.X + m.home[1] - l.X, ORIGIN.Y + m.home[2] - l.Y, ORIGIN.Z + m.home[3] - l.Z
                    local d = math.sqrt(dx * dx + dy * dy + dz * dz)
                    if d > 60 then
                        local k = math.min(1.6, 4000 / d)
                        safe(function() m.comp:SetPhysicsLinearVelocity({ X = dx * k, Y = dy * k, Z = dz * k }, false, FName("None")) end)
                    end
                end
            end
            if refresh then
                safe(function() m.actor.NotGroundedTime = 1e12 end)
                if not m.anim then enforce(m) end
            end
        end
    end
    if cur.startMarble and refresh and alive(cur.startMarble) then
        safe(function() cur.startMarble.actor.NotGroundedTime = 1e12 end)
        enforce(cur.startMarble)
    end
    local kill = cur.rules.killHeight or -60000
    for _, sp in ipairs(cur.spawners) do
        local active = true
        if sp.channel and sp.channel ~= "" then active = cur.triggers[sp.channel] ~= nil end
        if active then
            local pos, axes = sp.pos, sp.axes
            if sp.anim then pos, axes = evalAnim(sp.anim, animTime(sp.anim, t), sp.pos, sp.axes) end
            sp.timer = sp.timer - dt
            local made = 0
            while sp.timer <= 0 and made < 2 do
                sp.timer = sp.timer + math.max(0.1, sp.interval or 0.35)
                made = made + 1
                if #sp.live >= (sp.max or 60) then killMarble(table.remove(sp.live, 1)) end
                local f, sd = axes[1], axes[2]
                local a = (math.random() - 0.5) * (sp.spread or 0)
                local b2 = (math.random() - 0.5) * (sp.spread or 0)
                local at = { pos[1] + f[1] * a + sd[1] * b2, pos[2] + f[2] * a + sd[2] * b2, pos[3] + f[3] * a + sd[3] * b2 }
                local ang = (math.random() - 0.5) * (sp.angle or 60) * D
                local dir = rotateVec(f, { 0, 0, 1 }, ang)
                local lo = sp.speedMin or (sp.speed or 13000) * 0.35
                local hi = sp.speedMax or sp.speed or 13000
                if lo > hi then lo, hi = hi, lo end
                local sv = lo + math.random() * (hi - lo)
                local mat = nil
                if sp.gems and #sp.gems > 0 then mat = sp.gems[math.random(#sp.gems)] end
                local mb = spawnMarble(world, at, { mat = mat, mode = sp.mode or "roll", vel = { dir[1] * sv, dir[2] * sv, dir[3] * sv } })
                if mb then sp.live[#sp.live + 1] = mb end
            end
            if refresh then
                for i = #sp.live, 1, -1 do
                    local m = sp.live[i]
                    local l = alive(m) and m.comp and safe(function() return m.comp:K2_GetComponentLocation() end)
                    if not l or l.Z - ORIGIN.Z < kill then
                        killMarble(m)
                        table.remove(sp.live, i)
                    else
                        safe(function() m.actor.NotGroundedTime = 1e12 end)
                        enforce(m)
                    end
                end
            end
        end
    end
end

function M.state()
    local L = {}
    if cur then
        local n = 0
        for _ in pairs(cur.cps) do n = n + 1 end
        local status = lastStatus
        if status == "loading" then status = ("loading %d/%d"):format(#cur.spawned + #cur.marbles, #cur.spawned + #cur.queue + #cur.marbles + #cur.mqueue) end
        L[#L + 1] = "map_status=" .. status
        L[#L + 1] = "map_file=" .. cur.file
        L[#L + 1] = "map_name=" .. tostring(cur.name):gsub("[\r\n|]", " ")
        L[#L + 1] = ("map_time=%.2f"):format(cur.runTime or 0)
        L[#L + 1] = "map_running=" .. ((cur.runStart and not cur.finished) and "1" or "0")
        if cur.finished then L[#L + 1] = ("map_finish=%.3f"):format(cur.finished) end
        if cur.best then L[#L + 1] = ("map_best=%.3f"):format(cur.best) end
        L[#L + 1] = "map_deaths=" .. cur.deaths
        L[#L + 1] = "map_cp=" .. n .. "/" .. cur.cpTotal
        if cur.failed then L[#L + 1] = "map_failed=" .. cur.failed end
        local live = #cur.marbles
        for _, sp in ipairs(cur.spawners) do live = live + #sp.live end
        L[#L + 1] = "map_marbles=" .. live
        if cur.msg and os.clock() - (cur.msgAt or 0) < 4 then L[#L + 1] = "map_msg=" .. tostring(cur.msg):gsub("[\r\n]", " ") end
    else
        L[#L + 1] = "map_status=" .. (pending and "waiting" or lastStatus)
        if pending then L[#L + 1] = "map_file=" .. pending end
        if lastError ~= "" then L[#L + 1] = "map_error=" .. lastError end
    end
    return L
end

function M.handle(kind, arg)
    if kind == "map_load" then
        M.load(arg)
    elseif kind == "map_unload" then
        pending = nil
        M.unload(false)
    elseif kind == "map_restart" then
        M.restart()
    elseif kind == "map_respawn" then
        local ch = ctx.getChar()
        if cur and valid(ch) then respawn(ch, "manual") end
    else
        return false
    end
    return true
end

function M.queue(file)
    pending = file
    lastStatus = "waiting"
end

function M.active()
    return cur ~= nil
end

function M.init(c)
    ctx = c
    math.randomseed(os.time())
    local f = io.open(ctx.bridgeDir .. "/maps_log.txt", "w")
    if f then f:close() end
    os.remove(ctx.bridgeDir .. "/maps_log.txt")
end

return M
