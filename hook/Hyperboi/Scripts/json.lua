local json = {}

local escapes = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

local function utf8char(cp)
    if cp < 0x80 then return string.char(cp) end
    if cp < 0x800 then return string.char(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F)) end
    if cp < 0x10000 then return string.char(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)) end
    return string.char(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F))
end

function json.decode(s)
    local i = 1
    local n = #s

    local function err(msg)
        error(("json: %s at %d"):format(msg, i), 0)
    end

    local function ws()
        while true do
            local c = s:byte(i)
            if c == 32 or c == 9 or c == 10 or c == 13 then
                i = i + 1
            else
                return
            end
        end
    end

    local value

    local function str()
        i = i + 1
        local parts = {}
        local start = i
        while true do
            local j = s:find('["\\]', i)
            if not j then err("unterminated string") end
            i = j
            local c = s:byte(i)
            if c == 34 then
                parts[#parts + 1] = s:sub(start, i - 1)
                i = i + 1
                return table.concat(parts)
            elseif c == 92 then
                parts[#parts + 1] = s:sub(start, i - 1)
                local e = s:sub(i + 1, i + 1)
                if e == "u" then
                    local cp = tonumber(s:sub(i + 2, i + 5), 16) or 63
                    i = i + 6
                    if cp >= 0xD800 and cp <= 0xDBFF and s:sub(i, i + 1) == "\\u" then
                        local lo = tonumber(s:sub(i + 2, i + 5), 16) or 0
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
                        i = i + 6
                    end
                    parts[#parts + 1] = utf8char(cp)
                else
                    parts[#parts + 1] = escapes[e] or e
                    i = i + 2
                end
                start = i
            else
                i = i + 1
            end
        end
    end

    local function num()
        local a, b = s:find("^-?%d+%.?%d*[eE]?[-+]?%d*", i)
        if not a then err("bad number") end
        local v = tonumber(s:sub(a, b))
        i = b + 1
        return v
    end

    local function arr()
        i = i + 1
        local out = {}
        ws()
        if s:byte(i) == 93 then
            i = i + 1
            return out
        end
        while true do
            out[#out + 1] = value()
            ws()
            local c = s:byte(i)
            i = i + 1
            if c == 93 then return out end
            if c ~= 44 then err("expected , or ]") end
        end
    end

    local function obj()
        i = i + 1
        local out = {}
        ws()
        if s:byte(i) == 125 then
            i = i + 1
            return out
        end
        while true do
            ws()
            if s:byte(i) ~= 34 then err("expected key") end
            local k = str()
            ws()
            if s:byte(i) ~= 58 then err("expected :") end
            i = i + 1
            out[k] = value()
            ws()
            local c = s:byte(i)
            i = i + 1
            if c == 125 then return out end
            if c ~= 44 then err("expected , or }") end
        end
    end

    value = function()
        ws()
        local c = s:byte(i)
        if c == 123 then return obj() end
        if c == 91 then return arr() end
        if c == 34 then return str() end
        if c == 116 and s:sub(i, i + 3) == "true" then
            i = i + 4
            return true
        end
        if c == 102 and s:sub(i, i + 4) == "false" then
            i = i + 5
            return false
        end
        if c == 110 and s:sub(i, i + 3) == "null" then
            i = i + 4
            return nil
        end
        return num()
    end

    local ok, res = pcall(value)
    if not ok then return nil, res end
    return res
end

return json
