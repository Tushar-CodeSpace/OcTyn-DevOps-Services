import pymongo

def _coerce_val_candidates_lite(vals):
    candidates = []
    for v in vals:
        if v == "":
            candidates.append("")
            continue
        if v is None:
            candidates.append(None)
            continue
        s = str(v).strip()
        if not s:
            continue
        candidates.append(s)
        try:
            if s.isdigit():
                candidates.append(int(s))
            else:
                candidates.append(float(s))
        except ValueError:
            pass
        if s.lower() == "true":
            candidates.append(True)
        elif s.lower() == "false":
            candidates.append(False)
        elif s.lower() in ("null", "none"):
            candidates.append(None)
    out = []
    for c in candidates:
        if c not in out:
            out.append(c)
    return out


def _parse_field_conditions(entries, default_field):
    res = {}
    for item in entries:
        if item is None:
            continue
        s = str(item).strip()
        if s.lower().startswith("where "):
            s = s[6:].strip()
        has_delim = False
        field = default_field
        val_str = s
        if ":" in s:
            parts = s.split(":", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
            has_delim = True
        elif "=" in s:
            parts = s.split("=", 1)
            field = parts[0].strip()
            val_str = parts[1].strip()
            has_delim = True
        if not field:
            field = default_field

        vals = []
        if val_str.startswith("[") and val_str.endswith("]"):
            inner = val_str[1:-1]
            for x in inner.split(","):
                xs = x.strip()
                if xs in ('""', "''"):
                    vals.append("")
                else:
                    c = xs.strip("'\"")
                    if c or xs:
                        vals.append(c)
        elif val_str in ('""', "''"):
            vals = [""]
        elif has_delim and val_str == "":
            vals = [""]
        else:
            cleaned = val_str.strip("'\"")
            if cleaned or val_str in ('""', "''"):
                vals = [cleaned]
            elif not has_delim and not s:
                continue

        if field not in res:
            res[field] = []
        for v in vals:
            if v not in res[field]:
                res[field].append(v)
    return res


# Test parsing
entries = ['rejection_data.display_rejection: PSTR', 'rejection_data.display_rejection: ""']
parsed = _parse_field_conditions(entries, "status")
print("Parsed:", parsed)
assert parsed == {"rejection_data.display_rejection": ["PSTR", ""]}

# Test candidates coercion
cands = _coerce_val_candidates_lite(parsed["rejection_data.display_rejection"])
print("Candidates:", cands)
assert cands == ["PSTR", ""]

# Test single quotes
entries_single = ["rejection_data.display_rejection: PSTR", "rejection_data.display_rejection: ''"]
parsed_single = _parse_field_conditions(entries_single, "status")
print("Parsed single quotes:", parsed_single)
assert parsed_single == {"rejection_data.display_rejection": ["PSTR", ""]}

# Test colon empty
entries_empty = ["rejection_data.display_rejection: PSTR", "rejection_data.display_rejection:"]
parsed_empty = _parse_field_conditions(entries_empty, "status")
print("Parsed empty after colon:", parsed_empty)
assert parsed_empty == {"rejection_data.display_rejection": ["PSTR", ""]}

print("ALL PARSING & COERCION TESTS FOR EMPTY STRING PASSED 100%!")
