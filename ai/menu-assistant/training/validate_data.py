"""Standard-library preflight; the shared TypeScript contract remains authoritative."""
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
REASONS = {"BUDGET_FIT", "MENU_VARIETY", "REQUESTED_VEGETABLE", "REQUESTED_DRINK", "REQUESTED_DESSERT"}
FIELDS = {"PEOPLE", "BUDGET", "PREFERENCES"}
CATEGORIES = {"VEGETABLE": "RAU-DAU-HU", "DRINK": "DO-UONG", "DESSERT": "TRANG-MIENG"}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def needs_staff(request):
    preferences = request.get("preferences", {})
    if any(preferences.get(key) for key in ("diet", "spice", "proteins", "avoidIngredients", "allergies", "mealStyle")):
        return True
    words = "".join(c for c in unicodedata.normalize("NFKD", request["message"]) if not unicodedata.combining(c)).lower().replace("đ", "d")
    words = " ".join("".join(c if c.isalnum() else " " for c in words).split())
    return bool(re.search(r"(?:^| )(?:di ung|allerg\w*|phan ve|chay|vegan|vegetarian|cay|spicy|kieng|tranh|avoid|exclude|without|free from|khong an|khong dung|khong them|no nuts|no seafood|nut free|dairy free|gluten free|hai san|thit bo|thit heo|thit ga|thit vit|an nhe|dung chung|chia se)(?: |$)", words))

def validate_record(row, expected_policy=None):
    require(isinstance(row, dict) and set(row) == {"id", "groupId", "scenario", "source", "messages"}, "record keys")
    for key in ("id", "groupId", "scenario"):
        require(isinstance(row[key], str) and bool(row[key].strip()), f"invalid {key}")
    require(row["source"] == "CURATED_SYNTHETIC", "source must be CURATED_SYNTHETIC")
    messages = row["messages"]
    require(isinstance(messages, list) and len(messages) == 3, "exactly three messages required")
    for message, role in zip(messages, ("system", "user", "assistant")):
        require(isinstance(message, dict) and set(message) == {"role", "content"}, "message keys")
        require(message["role"] == role and isinstance(message["content"], str) and message["content"].strip(), "message role/content")
    if expected_policy is not None:
        require(messages[0]["content"] == expected_policy, "system policy differs from shared contract")
    inp = json.loads(messages[1]["content"])
    decision = json.loads(messages[2]["content"])
    require(set(inp) == {"request", "context"}, "provider input keys")
    request, context = inp["request"], inp["context"]
    require(isinstance(request, dict) and set(request) <= {"message", "people", "budgetAmount", "preferences"}, "request keys")
    require(isinstance(request.get("message"), str) and 1 <= len(request["message"].strip()) <= 1000, "request message")
    if "people" in request:
        require(type(request["people"]) is int and 1 <= request["people"] <= 20, "people")
    if "budgetAmount" in request:
        require(isinstance(request["budgetAmount"], str) and re.fullmatch(r"[1-9][0-9]{0,8}", request["budgetAmount"]), "budgetAmount")
    preferences = request.get("preferences", {})
    require(isinstance(preferences, dict) and set(preferences) <= {"diet", "spice", "proteins", "avoidIngredients", "allergies", "mealStyle", "include"}, "preferences keys")
    for key, allowed in (("diet", {"VEGETARIAN"}), ("spice", {"NOT_SPICY"}), ("mealStyle", {"LIGHT", "SHARED"})):
        if key in preferences: require(preferences[key] in allowed, f"preferences {key}")
    for key, allowed, limit in (("proteins", {"SEAFOOD", "BEEF", "PORK", "CHICKEN", "DUCK"}, 5), ("include", set(CATEGORIES), 3), ("avoidIngredients", None, 10), ("allergies", None, 10)):
        if key in preferences:
            values = preferences[key]
            require(isinstance(values, list) and len(values) <= limit and all(isinstance(v, str) and 1 <= len(v.strip()) <= 80 for v in values) and len(set(values)) == len(values), f"preferences {key}")
            if allowed: require(set(values) <= allowed, f"preferences {key} values")
    require(set(context) == {"menu", "catalogTruncated", "currency", "priceIncludesVat", "semanticMetadata"}, "context keys")
    require(type(context["catalogTruncated"]) is bool and context["currency"] == "VND" and context["priceIncludesVat"] is True and context["semanticMetadata"] == "UNREVIEWED", "context metadata")
    require(isinstance(context["menu"], list) and len(context["menu"]) <= 8, "fixture menu exceeds eight products")
    menu = {}
    product_keys = {"productId", "code", "name", "description", "categoryCode", "categoryName", "unitPrice", "productKind", "version", "available", "ingredients", "components"}
    for product in context["menu"]:
        require(isinstance(product, dict) and set(product) == product_keys, "menu product keys")
        ident = product["productId"]
        parsed_id = uuid.UUID(ident)
        require(str(parsed_id) == ident and parsed_id.version in range(1, 9) and ident not in menu, "menu product UUID/duplicate")
        for key in ("code", "name", "description", "categoryCode", "categoryName"):
            require(isinstance(product[key], str) and bool(product[key].strip()), f"product {key}")
        require(isinstance(product["unitPrice"], str) and re.fullmatch(r"[0-9]{1,9}", product["unitPrice"]), "fixture unitPrice must be integer VND")
        require(product["productKind"] in {"DISH", "COMBO"} and type(product["version"]) is int and product["version"] >= 1 and type(product["available"]) is bool, "product metadata")
        require(isinstance(product["ingredients"], list) and all(isinstance(v, str) for v in product["ingredients"]), "ingredients")
        require(isinstance(product["components"], list), "components")
        for component in product["components"]:
            require(set(component) == {"productId", "name", "quantity"} and type(component["quantity"]) is int and component["quantity"] >= 1, "component")
            uuid.UUID(component["productId"])
        menu[ident] = product
    require(isinstance(decision, dict) and set(decision) == {"kind", "products", "clarificationFields"}, "decision keys")
    require(decision["kind"] in KINDS and isinstance(decision["products"], list) and len(decision["products"]) <= 6, "decision kind/products")
    fields = decision["clarificationFields"]
    require(isinstance(fields, list) and all(isinstance(v, str) for v in fields) and len(set(fields)) == len(fields) and set(fields) <= FIELDS, "clarificationFields")
    chosen = set()
    total = 0
    for product in decision["products"]:
        require(set(product) == {"productId", "quantity", "reasonCode"}, "decision product keys")
        ident = product["productId"]
        require(ident in menu and ident not in chosen and menu[ident]["available"], "unknown/duplicate/unavailable product")
        require(type(product["quantity"]) is int and 1 <= product["quantity"] <= 20 and product["reasonCode"] in REASONS, "quantity/reasonCode")
        chosen.add(ident)
        total += int(menu[ident]["unitPrice"]) * product["quantity"]
        if product["reasonCode"].startswith("REQUESTED_"):
            include = product["reasonCode"][10:]
            require(include in preferences.get("include", []) and menu[ident]["categoryCode"] == CATEGORIES[include], "requested category reason")
    kind = decision["kind"]
    require(bool(chosen) and not fields if kind == "RECOMMEND" else not chosen and (bool(fields) if kind == "CLARIFY" else not fields), "kind shape invariant")
    missing = [field for field, key in (("PEOPLE", "people"), ("BUDGET", "budgetAmount")) if key not in request]
    if needs_staff(request): require(kind == "REFER_STAFF", "unreviewed semantic request must refer staff")
    elif missing: require(kind == "CLARIFY" and set(fields) == set(missing), "missing structured people/budget")
    if kind == "RECOMMEND":
        require(total <= int(request["budgetAmount"]), "over budget")
        for include in preferences.get("include", []):
            require(any(menu[ident]["categoryCode"] == CATEGORIES[include] for ident in chosen), "requested category missing")
    return inp, decision

def validate_dataset(base):
    base = Path(base).resolve()
    contract_path = base.parent.parent / "packages/contracts/src/menu-assistant.ts"
    expected_policy = None
    if contract_path.exists():
        match = re.search(r"export const assistantSystemPolicy = `([^`]+)`;", contract_path.read_text(encoding="utf-8"))
        require(match is not None, "shared policy export not found")
        expected_policy = match.group(1)
    ids, groups, fingerprints, menus, policies = {}, {}, {}, {}, set()
    result = {"contractPolicyChecked": expected_policy is not None, "splits": {}}
    for split in SPLITS:
        path = base / "data" / f"{split}.jsonl"
        require(path.exists(), f"missing {path.name}")
        rows = []
        counts = collections.Counter()
        scenario_counts = collections.Counter()
        menus[split] = set()
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            require(bool(line.strip()), f"blank line in {split}:{line_number}")
            row = json.loads(line)
            try: inp, decision = validate_record(row, expected_policy)
            except (ValueError, TypeError, KeyError) as error: raise ValueError(f"{split}:{line_number}: {error}") from error
            require(row["id"] not in ids, f"duplicate id {row['id']}")
            ids[row["id"]] = split
            owner = groups.setdefault(row["groupId"], split)
            require(owner == split, f"group crosses splits: {row['groupId']}")
            fingerprint = hashlib.sha256(canonical(inp).encode()).hexdigest()
            require(fingerprint not in fingerprints, f"duplicate provider input: {row['id']}")
            fingerprints[fingerprint] = row["id"]
            menus[split].update(product["productId"] for product in inp["context"]["menu"])
            policies.add(row["messages"][0]["content"])
            counts[decision["kind"]] += 1
            scenario_counts[row["scenario"]] += 1
            rows.append(row)
        require(bool(rows), f"empty split {split}")
        result["splits"][split] = {"count": len(rows), "sha256": sha256_file(path), "kinds": dict(counts), "scenarios": dict(scenario_counts)}
    require(len(policies) == 1, "system policies differ")
    for index, first in enumerate(SPLITS):
        for second in SPLITS[index + 1:]:
            require(not menus[first].intersection(menus[second]), f"menu UUID families cross {first}/{second}")
    result["systemPolicySha256"] = hashlib.sha256(next(iter(policies)).encode()).hexdigest()
    result["total"] = len(ids)
    result["checks"] = ["record/schema preflight", "shared policy when available", "unique ids/groups/inputs across splits", "held-out menu UUID families", "available IDs", "integer VND arithmetic", "category include coverage", "staff and clarification guards"]
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    print(json.dumps(validate_dataset(args.base), ensure_ascii=False, indent=2))
