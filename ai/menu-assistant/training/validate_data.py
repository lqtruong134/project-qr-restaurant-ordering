"""CPU-only curated-data preflight. The TypeScript contract/evaluator is authoritative."""
from pathlib import Path
import argparse
import collections
import hashlib
import json
import re
import unicodedata
import uuid

SPLITS = ("train", "validation", "evaluation")
KINDS = {"RECOMMEND", "CLARIFY", "REFER_STAFF", "NO_MATCH"}
FIELDS = {"PEOPLE", "BUDGET", "PREFERENCES"}
TOOLS = {"listCategories", "searchMenu", "getProducts"}
CATEGORIES = {"VEGETABLE": "RAU-DAU-HU", "DRINK": "DO-UONG", "DESSERT": "TRANG-MIENG"}
PRODUCT_KEYS = {"productId", "code", "name", "description", "categoryCode", "categoryName", "unitPrice", "productKind", "version", "available", "ingredients", "components"}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def canonical(value):
    if isinstance(value, str):
        return " ".join(unicodedata.normalize("NFKC", value).strip().lower().split())
    if isinstance(value, list):
        return [canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: canonical(value[key]) for key in sorted(value)}
    return value

def fingerprint(value):
    return json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def money(value, digits=9, positive=False):
    return isinstance(value, str) and bool(re.fullmatch(r"[1-9][0-9]{0," + str(digits - 1) + "}" if positive else r"(?:0|[1-9][0-9]{0," + str(digits - 1) + "})", value))

def ident(value):
    require(isinstance(value, str), "UUID must be text")
    parsed = uuid.UUID(value)
    require(parsed.version in range(1, 9), "invalid UUID version")

def validate_arguments(name, args):
    require(name in TOOLS and isinstance(args, dict), "unknown tool or invalid args")
    if name == "listCategories":
        require(not args, "listCategories takes no arguments")
    elif name == "getProducts":
        require(set(args) == {"productIds"} and isinstance(args["productIds"], list) and 1 <= len(args["productIds"]) <= 20, "getProducts args")
        for value in args["productIds"]: ident(value)
        require(len({value.lower() for value in args["productIds"]}) == len(args["productIds"]), "duplicate productIds")
    else:
        require(set(args) <= {"query", "categoryCode", "productKind", "minUnitPrice", "maxUnitPrice", "availableOnly", "limit", "offset"}, "searchMenu keys")
        for key, size in (("query", 160), ("categoryCode", 80)):
            if key in args: require(isinstance(args[key], str) and 1 <= len(args[key].strip()) <= size, key)
        if "productKind" in args: require(args["productKind"] in {"DISH", "COMBO"}, "productKind")
        for key in ("minUnitPrice", "maxUnitPrice"):
            if key in args: require(money(args[key]), key)
        if "availableOnly" in args: require(type(args["availableOnly"]) is bool, "availableOnly")
        if "limit" in args: require(type(args["limit"]) is int and 1 <= args["limit"] <= 30, "limit")
        if "offset" in args: require(type(args["offset"]) is int and 0 <= args["offset"] <= 1000, "offset")
    return args

def replay_tool(facts, name, args):
    validate_arguments(name, args)
    menu = sorted(facts["menu"], key=lambda p: p["code"])
    if name == "listCategories":
        categories = {p["categoryCode"]: {"code": p["categoryCode"], "name": p["categoryName"]} for p in menu}
        return {"categories": [categories[key] for key in sorted(categories)], "truncated": False, "asOf": facts["asOf"]}
    if name == "getProducts":
        ids = {value.lower() for value in args["productIds"]}
        products = [p for p in menu if p["productId"].lower() in ids]
        limit, offset = 20, 0
    else:
        query = args.get("query", "").lower()
        products = [p for p in menu if
            (not query or query in (p["name"] + " " + p["description"] + " " + p["code"]).lower()) and
            (not args.get("categoryCode") or p["categoryCode"] == args["categoryCode"]) and
            (not args.get("productKind") or p["productKind"] == args["productKind"]) and
            (not args.get("availableOnly") or p["available"]) and
            ("minUnitPrice" not in args or int(p["unitPrice"]) >= int(args["minUnitPrice"])) and
            ("maxUnitPrice" not in args or int(p["unitPrice"]) <= int(args["maxUnitPrice"]))]
        limit, offset = args.get("limit", 20), args.get("offset", 0)
    return {"products": products[offset:offset + limit], "truncated": len(products) > offset + limit, "asOf": facts["asOf"]}

def validate_decision(decision):
    require(isinstance(decision, dict) and set(decision) == {"kind", "message", "products", "totalAmount", "clarificationFields", "warnings"}, "decision keys")
    require(decision["kind"] in KINDS and isinstance(decision["message"], str) and 1 <= len(decision["message"].strip()) <= 4000, "decision kind/message")
    require(isinstance(decision["products"], list) and len(decision["products"]) <= 6 and money(decision["totalAmount"], 12), "products/total")
    require(isinstance(decision["clarificationFields"], list) and set(decision["clarificationFields"]) <= FIELDS and len(set(decision["clarificationFields"])) == len(decision["clarificationFields"]), "clarification fields")
    require(isinstance(decision["warnings"], list) and len(decision["warnings"]) <= 6 and all(isinstance(v, str) and 1 <= len(v.strip()) <= 500 for v in decision["warnings"]), "warnings")
    for item in decision["products"]:
        require(set(item) == {"productId", "name", "quantity", "unitPrice", "lineTotal", "reason"}, "product claim keys")
        ident(item["productId"])
        require(isinstance(item["name"], str) and 1 <= len(item["name"].strip()) <= 160 and isinstance(item["reason"], str) and 1 <= len(item["reason"].strip()) <= 500, "claim text")
        require(type(item["quantity"]) is int and 1 <= item["quantity"] <= 20 and money(item["unitPrice"]) and money(item["lineTotal"], 12), "claim numbers")
    return decision

def validate_record(row, expected_policy=None):
    require(isinstance(row, dict) and set(row) == {"id", "groupId", "scenario", "source", "facts", "messages"}, "record keys")
    for key in ("id", "groupId", "scenario"):
        require(isinstance(row[key], str) and row[key] == row[key].strip() and bool(row[key]), key)
    require(row["source"] == "CURATED_SYNTHETIC", "source")
    facts = row["facts"]
    require(set(facts) == {"menu", "asOf", "people", "budgetAmount", "include", "requiredProductIds", "forbiddenProductIds", "expectedClarificationFields", "allergyCase"}, "facts keys")
    require(isinstance(facts["menu"], list) and len(facts["menu"]) <= 8, "fixture menu max8")
    require(facts["people"] is None or type(facts["people"]) is int and 1 <= facts["people"] <= 20, "people fact")
    require(facts["budgetAmount"] is None or money(facts["budgetAmount"], positive=True), "budget fact")
    require(set(facts["include"]) <= set(CATEGORIES) and set(facts["expectedClarificationFields"]) <= FIELDS and type(facts["allergyCase"]) is bool, "fact constraints")
    menu = {}
    for product in facts["menu"]:
        require(set(product) == PRODUCT_KEYS, "public product keys")
        ident(product["productId"])
        require(product["productId"].lower() not in menu and money(product["unitPrice"]) and type(product["available"]) is bool, "product ID/price/availability")
        require(product["productKind"] in {"DISH", "COMBO"} and type(product["version"]) is int and product["version"] >= 1, "product metadata")
        for key in ("code", "name", "description", "categoryCode", "categoryName"): require(isinstance(product[key], str), key)
        require(isinstance(product["ingredients"], list) and len(product["ingredients"]) <= 40 and all(isinstance(v, str) for v in product["ingredients"]), "ingredient names")
        require(isinstance(product["components"], list) and len(product["components"]) <= 20, "components")
        for component in product["components"]:
            require(set(component) == {"productId", "name", "quantity"} and type(component["quantity"]) is int and 1 <= component["quantity"] <= 20, "component")
            ident(component["productId"])
        menu[product["productId"].lower()] = product
    messages = row["messages"]
    require(isinstance(messages, list) and 3 <= len(messages) <= 19, "trajectory length")
    for message in messages: require(set(message) == {"role", "content"} and isinstance(message["content"], str), "message")
    require(messages[0]["role"] == "system" and messages[1]["role"] == "user", "initial roles")
    if expected_policy is not None: require(messages[0]["content"] == expected_policy, "shared policy mismatch")
    inp = json.loads(messages[1]["content"])
    require(set(inp) == {"request", "context", "tools"} and set(inp["request"]) <= {"message", "history", "people", "budgetAmount", "preferences"}, "provider keys")
    require(set(inp["context"]) == {"currency", "priceIncludesVat", "pricingBasis", "semanticMetadata"} and inp["context"] == {"currency": "VND", "priceIncludesVat": True, "pricingBasis": "MENU_BEFORE_DISCOUNTS", "semanticMetadata": "UNREVIEWED"}, "static context")
    require([tool["name"] for tool in inp["tools"]] == ["listCategories", "searchMenu", "getProducts"], "approved tools")
    require(isinstance(inp["request"]["message"], str) and 1 <= len(inp["request"]["message"].strip()) <= 1000, "request message")
    history = inp["request"].get("history", [])
    require(isinstance(history, list) and len(history) <= 8 and all(set(m) == {"role", "content"} and m["role"] in {"user", "assistant"} and isinstance(m["content"], str) and 1 <= len(m["content"].strip()) <= 1000 for m in history), "history")
    observed, decision, index = set(), None, 2
    while index < len(messages):
        message = messages[index]
        require(message["role"] == "assistant", "assistant turn")
        turn = json.loads(message["content"])
        if turn.get("type") == "FINAL":
            require(set(turn) == {"type", "decision"} and index == len(messages) - 1, "final turn")
            decision = validate_decision(turn["decision"])
            break
        require(set(turn) == {"type", "name", "arguments"} and turn["type"] == "TOOL_CALL", "tool call")
        index += 1
        require(index < len(messages) and messages[index]["role"] == "tool", "tool observation missing")
        observation = json.loads(messages[index]["content"])
        require(set(observation) == {"name", "result"} and observation["name"] == turn["name"], "observation keys")
        result = replay_tool(facts, turn["name"], turn["arguments"])
        require(observation["result"] == result, "tool observation differs from truth")
        observed.update(p["productId"].lower() for p in result.get("products", []))
        index += 1
    require(decision is not None, "missing final")
    selected, total = set(), 0
    for item in decision["products"]:
        pid = item["productId"].lower()
        require(pid in menu and pid in observed and pid not in selected, "gold hallucination/unread/duplicate")
        selected.add(pid)
        product = menu[pid]
        require(product["available"] and product["name"] == item["name"] and product["unitPrice"] == item["unitPrice"], "gold false claim")
        line_total = int(product["unitPrice"]) * item["quantity"]
        require(str(line_total) == item["lineTotal"], "gold arithmetic")
        total += line_total
    require(str(total) == decision["totalAmount"], "gold total")
    require(set(decision["clarificationFields"]) == set(facts["expectedClarificationFields"]), "gold clarification")
    if decision["kind"] == "RECOMMEND":
        require(bool(selected) and not decision["clarificationFields"], "recommend intent")
        if facts["budgetAmount"] is not None: require(total <= int(facts["budgetAmount"]), "gold budget")
        for include in facts["include"]: require(any(menu[pid]["categoryCode"] == CATEGORIES[include] for pid in selected), "gold include")
        require(set(facts["requiredProductIds"]) <= selected and not set(facts["forbiddenProductIds"]).intersection(selected), "gold preferences")
    else: require(not selected and total == 0, "nonrecommend intent")
    if facts["allergyCase"]:
        prose = " ".join(unicodedata.normalize("NFKD", decision["message"]).lower().replace("đ", "d").split())
        prose = "".join(c for c in prose if not unicodedata.combining(c))
        require(decision["kind"] == "REFER_STAFF" and "nhan vien" in prose and ("chua" in prose or "khong the" in prose), "allergy referral/limits proxy")
    return inp, decision

def validate_dataset(base):
    base = Path(base).resolve()
    contract_path = base.parent.parent / "packages/contracts/src/menu-assistant.ts"
    expected_policy = None
    if contract_path.exists():
        match = re.search(r"export const assistantSystemPolicy\s*=\s*(['" + chr(96) + r"])(.*?)\1;", contract_path.read_text(encoding="utf-8"), re.S)
        require(match is not None, "shared policy export not found")
        expected_policy = match.group(2)
    ids, groups, prompts, menus, policies, definitions = {}, {}, {}, {}, set(), set()
    result = {"contractVersion": 2, "contractPolicyChecked": expected_policy is not None, "modelQualityMeasured": False, "splits": {}}
    for split in SPLITS:
        path = base / "data" / (split + ".jsonl")
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        require(bool(rows), "empty split " + split)
        counts, scenarios = collections.Counter(), collections.Counter()
        menus[split] = set()
        assistant_turns = 0
        for row in rows:
            inp, decision = validate_record(row, expected_policy)
            require(row["id"] not in ids, "duplicate case ID")
            ids[row["id"]] = split
            require(groups.setdefault(row["groupId"], split) == split, "group split leakage")
            key = fingerprint({"input": inp, "facts": row["facts"]})
            require(key not in prompts, "duplicate complete scenario")
            prompts[key] = split
            menus[split].update(p["productId"].lower() for p in row["facts"]["menu"])
            policies.add(row["messages"][0]["content"])
            definitions.add(fingerprint(inp["tools"]))
            assistant_turns += sum(m["role"] == "assistant" for m in row["messages"])
            counts[decision["kind"]] += 1
            scenarios[row["scenario"]] += 1
        result["splits"][split] = {"count": len(rows), "assistantTurns": assistant_turns, "sha256": sha256_file(path), "kinds": dict(counts), "scenarios": dict(scenarios)}
    require(len(policies) == 1 and len(definitions) == 1, "policies/tool definitions differ")
    for index, first in enumerate(SPLITS):
        for second in SPLITS[index + 1:]: require(not menus[first].intersection(menus[second]), "menu UUID split leakage")
    result["systemPolicySha256"] = hashlib.sha256(next(iter(policies)).encode()).hexdigest()
    result["total"] = len(ids)
    result["checks"] = ["public fields and protocol", "approved tool arguments", "tool trajectories versus independent truth", "gold claim/price/budget consistency", "group/ID/scenario/menu separation", "allergy referral wording proxy"]
    result["limitations"] = ["TypeScript validator remains authoritative", "synthetic consistency is not model quality", "free-text safety and recommendation quality need human review"]
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path(__file__).resolve().parent.parent)
    print(json.dumps(validate_dataset(parser.parse_args().base), ensure_ascii=False, indent=2))
