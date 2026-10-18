local M = {}

local ctx
local menu = nil
local menuName = ""
local ourBtn = nil
local ourBtnDown = false
local picker = nil
local pickerButtons = {}
local injected = false
local pendingInject = nil

local MENU_CLASS = "/Game/Blueprints/UI/Menus/WB_MMenu.WB_MMenu_C"
local PLAY_LEVEL = "LevelMaster1"

local function safe(f, ...)
    local ok, a, b = pcall(f, ...)
    if ok then return a, b end
    return nil
end

local function valid(o)
    return o ~= nil and safe(function() return o:IsValid() end) == true
end

local function log(msg)
    local f = io.open(ctx.bridgeDir .. "/menu_log.txt", "a")
    if f then
        f:write(os.date("%H:%M:%S ") .. tostring(msg) .. "\n")
        f:close()
    end
end

local function className(w)
    return safe(function() return w:GetClass():GetFName():ToString() end) or "?"
end

local function objName(w)
    return safe(function() return w:GetFName():ToString() end) or "?"
end

local function textOf(w)
    local t = safe(function() return w:GetText():ToString() end)
    if t then return t end
    return safe(function() return w.Text:ToString() end)
end

local function children(w)
    local out = {}
    local n = safe(function() return w:GetChildrenCount() end)
    if type(n) == "number" then
        for i = 0, n - 1 do
            local c = safe(function() return w:GetChildAt(i) end)
            if valid(c) then out[#out + 1] = c end
        end
        return out
    end
    local c = safe(function() return w:GetContent() end)
    if valid(c) then out[#out + 1] = c end
    local tree = safe(function() return w.WidgetTree end)
    if valid(tree) then
        local root = safe(function() return tree.RootWidget end)
        if valid(root) then out[#out + 1] = root end
    end
    return out
end

local function walk(w, depth, fn, seen)
    seen = seen or {}
    if not valid(w) or depth > 40 then return end
    local key = safe(function() return w:GetFullName() end) or tostring(w)
    if seen[key] then return end
    seen[key] = true
    if fn(w, depth) == false then return end
    for _, c in ipairs(children(w)) do walk(c, depth + 1, fn, seen) end
end

local function dump(m)
    local f = io.open(ctx.bridgeDir .. "/menu_dump.txt", "w")
    if not f then return end
    f:write("menu " .. (safe(function() return m:GetFullName() end) or "?") .. "\n")
    local tree = safe(function() return m.WidgetTree end)
    local root = valid(tree) and safe(function() return tree.RootWidget end)
    walk(root, 0, function(w, d)
        local t = textOf(w)
        local vis = safe(function() return w:GetVisibility() end)
        f:write(string.rep("  ", d) .. className(w) .. " " .. objName(w) .. (t and (' "' .. t:gsub("\n", " ") .. '"') or "") .. (vis and (" vis=" .. tostring(vis)) or "") .. "\n")
    end)
    local fns = {}
    safe(function()
        m:GetClass():ForEachFunction(function(fn)
            fns[#fns + 1] = fn:GetFName():ToString()
        end)
    end)
    f:write("functions: " .. table.concat(fns, ", ") .. "\n")
    f:close()
    log("menu dumped")
end

local function findOptions(m)
    local tree = safe(function() return m.WidgetTree end)
    local root = valid(tree) and safe(function() return tree.RootWidget end)
    local hit = nil
    walk(root, 0, function(w)
        if hit then return false end
        local t = textOf(w)
        if t and t:lower():find("option") then
            hit = w
            return false
        end
    end)
    if not hit then return nil end
    local btn = hit
    for _ = 1, 8 do
        if className(btn):find("Button") then break end
        local p = safe(function() return btn:GetParent() end)
        if not valid(p) then break end
        btn = p
    end
    if not className(btn):find("Button") then return nil, hit end
    return btn, hit
end

local function findNamed(m, name)
    local tree = safe(function() return m.WidgetTree end)
    local root = valid(tree) and safe(function() return tree.RootWidget end)
    local hit = nil
    walk(root, 0, function(w)
        if hit then return false end
        if objName(w) == name then
            hit = w
            return false
        end
    end)
    if hit then return hit end
    local direct = safe(function() return m[name] end)
    if valid(direct) then return direct end
    return nil
end

local function construct(clsPath, outer, name)
    local c = StaticFindObject(clsPath)
    if not valid(c) then return nil end
    local o = safe(function() return StaticConstructObject(c, outer, FName(name)) end)
    if valid(o) then return o end
    return nil
end

local function makeButton(tree, name, label, styleBtn, styleText)
    local b = construct("/Script/UMG.Button", tree, name)
    local t = construct("/Script/UMG.TextBlock", tree, name .. "_Label")
    if not b or not t then return nil end
    if styleBtn then safe(function() b:SetStyle(styleBtn.WidgetStyle) end) end
    safe(function() t:SetText(FText(label)) end)
    if styleText then
        safe(function() t:SetFont(styleText.Font) end)
        safe(function() t:SetColorAndOpacity(styleText.ColorAndOpacity) end)
        safe(function() t:SetJustification(styleText.Justification) end)
    end
    safe(function() b:SetContent(t) end)
    return b, t
end

local function copySlot(from, to)
    if not valid(from) or not valid(to) then return end
    safe(function() to:SetPadding(from.Padding) end)
    safe(function() to:SetHorizontalAlignment(from.HorizontalAlignment) end)
    safe(function() to:SetVerticalAlignment(from.VerticalAlignment) end)
    safe(function() to:SetSize(from.Size) end)
end

local function injectOptions(m, tree)
    local box = findNamed(m, "OptionsBox")
    local styleBtn = findNamed(m, "opt_fullscreen") or findNamed(m, "opt_discord")
    local styleText = findNamed(m, "txt_Fullscreen") or findNamed(m, "txt_discord")
    if not valid(box) or not valid(styleBtn) then
        log("OptionsBox not found, falling back")
        return false
    end
    local b = makeButton(tree, "HB_CustomMaps", "Custom maps", styleBtn, styleText)
    if not b then
        log("couldn't construct button")
        return false
    end
    local slot = safe(function() return box:AddChildToVerticalBox(b) end) or safe(function() return box:AddChild(b) end)
    copySlot(safe(function() return styleBtn.Slot end), slot)
    ourBtn = b
    injected = true
    log("added Custom maps to the Options menu")
    return true
end

local function inject(m)
    local tree = safe(function() return m.WidgetTree end)
    if not valid(tree) then
        log("no widget tree")
        return
    end
    if injectOptions(m, tree) then return end
    local optBtn, optText = findOptions(m)
    if not optBtn then
        log("couldn't find an Options button" .. (optText and (" (found text in " .. className(optText) .. ")") or ""))
        return
    end
    local panel = safe(function() return optBtn:GetParent() end)
    if not valid(panel) then
        log("options button has no parent panel")
        return
    end
    local b = makeButton(tree, "HB_CustomMaps", "Custom maps", optBtn, optText)
    if not b then
        log("couldn't construct button")
        return
    end
    local slot = safe(function() return panel:AddChild(b) end)
    local optSlot = safe(function() return optBtn.Slot end)
    copySlot(optSlot, slot)
    if className(panel):find("Canvas") and valid(optSlot) and valid(slot) then
        local pos = safe(function() return optSlot:GetPosition() end)
        local size = safe(function() return optSlot:GetSize() end)
        local anch = safe(function() return optSlot:GetAnchors() end)
        if anch then safe(function() slot:SetAnchors(anch) end) end
        if size then safe(function() slot:SetSize(size) end) end
        if pos and size then safe(function() slot:SetPosition({ X = pos.X, Y = pos.Y + size.Y + 12 }) end) end
    end
    ourBtn = b
    injected = true
    log("injected Custom maps into " .. className(panel) .. " " .. objName(panel))
end

local function closePicker()
    if valid(picker) then safe(function() picker:RemoveFromParent() end) end
    picker = nil
    pickerButtons = {}
end

local function openPicker()
    closePicker()
    if not valid(menu) then return end
    local tree = safe(function() return menu.WidgetTree end)
    local root = valid(tree) and safe(function() return tree.RootWidget end)
    if not valid(root) then return end
    local optBtn, optText = findOptions(menu)
    local fsBtn = findNamed(menu, "opt_fullscreen")
    local fsText = findNamed(menu, "txt_Fullscreen")
    if valid(fsBtn) then optBtn = fsBtn end
    if valid(fsText) then optText = fsText end
    local border = construct("/Script/UMG.Border", tree, "HB_MapPicker")
    local box = construct("/Script/UMG.VerticalBox", tree, "HB_MapList")
    if not border or not box then
        log("couldn't build picker")
        return
    end
    safe(function() border:SetBrushColor({ R = 0.02, G = 0.03, B = 0.09, A = 0.92 }) end)
    safe(function() border:SetPadding({ Left = 36, Top = 28, Right = 36, Bottom = 28 }) end)
    safe(function() border:SetContent(box) end)
    local title = construct("/Script/UMG.TextBlock", tree, "HB_PickerTitle")
    if title then
        safe(function() title:SetText(FText("Custom maps")) end)
        if optText then safe(function() title:SetFont(optText.Font) end) end
        local s = safe(function() return box:AddChildToVerticalBox(title) end)
        if s then safe(function() s:SetPadding({ Left = 0, Top = 0, Right = 0, Bottom = 18 }) end) end
    end
    local maps = ctx.maps.readIndex()
    if #maps == 0 then
        local t = construct("/Script/UMG.TextBlock", tree, "HB_PickerEmpty")
        if t then
            safe(function() t:SetText(FText("No maps yet. Drop .hbmap files into the Maps page in Hyperboi.")) end)
            safe(function() box:AddChildToVerticalBox(t) end)
        end
    end
    for i, mp in ipairs(maps) do
        local label = mp.name ~= "" and mp.name or mp.file
        if mp.author and mp.author ~= "" then label = label .. "  by " .. mp.author end
        if mp.difficulty and mp.difficulty ~= "" then label = label .. "  (" .. mp.difficulty .. ")" end
        local b = makeButton(tree, "HB_Map_" .. i, label, optBtn, optText)
        if b then
            local s = safe(function() return box:AddChildToVerticalBox(b) end)
            if s then safe(function() s:SetPadding({ Left = 0, Top = 4, Right = 0, Bottom = 4 }) end) end
            pickerButtons[#pickerButtons + 1] = { btn = b, file = mp.file, down = false }
        end
    end
    local back = makeButton(tree, "HB_PickerBack", "Back", optBtn, optText)
    if back then
        local s = safe(function() return box:AddChildToVerticalBox(back) end)
        if s then safe(function() s:SetPadding({ Left = 0, Top = 18, Right = 0, Bottom = 0 }) end) end
        pickerButtons[#pickerButtons + 1] = { btn = back, back = true, down = false }
    end
    local slot = nil
    if className(root):find("Canvas") then
        slot = safe(function() return root:AddChildToCanvas(border) end)
        if slot then
            safe(function() slot:SetAnchors({ Minimum = { X = 0.5, Y = 0.5 }, Maximum = { X = 0.5, Y = 0.5 } }) end)
            safe(function() slot:SetAlignment({ X = 0.5, Y = 0.5 }) end)
            safe(function() slot:SetAutoSize(true) end)
            safe(function() slot:SetZOrder(1000) end)
        end
    else
        slot = safe(function() return root:AddChild(border) end)
    end
    picker = border
    log("picker opened with " .. #maps .. " maps")
end

local function playMap(file)
    closePicker()
    ctx.maps.queue(file)
    local gs = StaticFindObject("/Script/Engine.Default__GameplayStatics")
    local world = valid(menu) and safe(function() return menu:GetWorld() end)
    log("opening " .. PLAY_LEVEL .. " for " .. file)
    if gs and world then safe(function() gs:OpenLevel(world, FName(PLAY_LEVEL), true, "") end) end
end

local function pressed(b)
    return safe(function() return b:IsPressed() end) == true
end

function M.tick()
    if not menu then return end
    local live = safe(function() return FindFirstOf("WB_MMenu_C") end)
    if not valid(live) or (safe(function() return live:GetFullName() end) or "") ~= menuName then
        menu = nil
        menuName = ""
        ourBtn = nil
        picker = nil
        pickerButtons = {}
        pendingInject = nil
        return
    end
    if pendingInject and os.clock() >= pendingInject.at then
        local pm = pendingInject.m
        pendingInject = nil
        if valid(pm) then
            local ok, err = pcall(function()
                dump(pm)
                inject(pm)
            end)
            if not ok then log("inject error: " .. tostring(err)) end
        end
    end
    if valid(ourBtn) then
        local p = pressed(ourBtn)
        if ourBtnDown and not p then openPicker() end
        ourBtnDown = p
    end
    for _, pb in ipairs(pickerButtons) do
        if valid(pb.btn) then
            local p = pressed(pb.btn)
            if pb.down and not p then
                if pb.back then
                    closePicker()
                else
                    playMap(pb.file)
                end
                return
            end
            pb.down = p
        end
    end
end

local function onMenu(m)
    if not valid(m) then return end
    local n = safe(function() return m:GetFullName() end) or ""
    if n == menuName and injected then return end
    menu = m
    menuName = n
    injected = false
    ourBtn = nil
    closePicker()
    log("menu found " .. n)
    pendingInject = { m = m, at = os.clock() + 1.0 }
end

function M.scan()
    local m = FindFirstOf("WB_MMenu_C")
    if valid(m) then
        local n = safe(function() return m:GetFullName() end) or ""
        if n ~= menuName then onMenu(m) end
    elseif menu then
        pendingInject = nil
        menu = nil
        menuName = ""
        ourBtn = nil
        picker = nil
        pickerButtons = {}
    end
end

function M.openPicker()
    openPicker()
end

function M.play(file)
    if not valid(menu) then return false end
    playMap(file)
    return true
end

function M.init(c)
    ctx = c
    os.remove(ctx.bridgeDir .. "/menu_log.txt")
    log("watching for the main menu")
end

return M
