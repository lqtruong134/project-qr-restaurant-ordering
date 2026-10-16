# AI Menu Assistant advisory foundation (contract v2)

Status: controlled read tools, synthetic fixtures and a manual training notebook scaffold. The application defaults to OFF. No model has been downloaded, trained, served, benchmarked or deployed by this change. No AI UI, vector database, RAG or agent framework is added.

The AI owns READ + REASON + RECOMMEND + CONVERSE: natural-language understanding, choosing approved reads, selecting meals, budget reasoning, explanations and follow-up questions. Core cart/order/inventory/kitchen/promotion/payment/refund/account/session operations remain authoritative and separate. The API never repairs a structurally valid recommendation to make a model appear accurate.

## Public read protocol

Initial AssistantProviderInput contains request, public static context and the three approved tool definitions. It does not contain a prefetched full menu or credentials. Optional people/budget hints and at most eight user/assistant history messages help conversation; the model must also understand information stated naturally.

The provider can call listCategories({}), searchMenu({query?,categoryCode?,productKind?,minUnitPrice?,maxUnitPrice?,availableOnly?,limit?,offset?}) and getProducts({productIds}). Each result has asOf and truncated. Reads expose only public menu identity, names/descriptions, categories, current menu prices, product kind/version, public availability, ingredient names and combo components. No costs, quantities of internal stock, payroll, customer identity, audit records, payment secrets or SQL are returned. Scope is bound by the server's authenticated guest context; it is not a tool argument.

For future model adapters, assistantProviderTurnSchema defines JSON TOOL_CALL(name,arguments) or FINAL(decision). The runtime injected provider can implement that loop using options.tools.call; a real Qwen/Ollama adapter is not implemented. The manual notebook uses the same JSON protocol against deterministic synthetic fixture tools, not the live database. Fixture search pages sort by fixture code; live queries may use menu ordering. Both default to 20 results, with a maximum requested limit of 30.

A final decision contains kind, message, products(productId,name,quantity,unitPrice,lineTotal,reason), totalAmount, clarificationFields and warnings. Text is plain data, never executable HTML or commands. The parser checks JSON shape, size, bounded strings/quantities and UUID syntax. A valid unknown UUID, duplicated selection, invented name, wrong quoted price, wrong total or bad preference choice remains unchanged. The envelope marks advisoryOnly:true; AVAILABLE means transport success, not factual endorsement. Real add-to-cart/order actions are checked again by the existing core backend.

Allergy information is incomplete. The model policy must acknowledge limits and refer customers to staff instead of asserting absolute safety. Other unreviewed dietary/spice/portion requests may need clarification or caveats; the API does not force every such request into one replacement answer. Incomplete BOM ingredient names cannot certify allergen absence or vegetarian preparation.

## Synthetic data and independent facts

There are 24 train, 6 validation and 6 held-out evaluation scenarios. Every record is CURATED_SYNTHETIC and contains id, groupId, scenario, source, facts and messages. Facts are evaluator/tool-simulator truth, never initial model prompt content. Messages contain the exact shared system policy, initial provider input, zero or more assistant TOOL_CALL/tool observation pairs, then an assistant FINAL turn.

Fixtures cover natural number/budget understanding without structured hints, history reuse, category requests, combo/ingredients, runtime price/availability changes, preference clarification, limited advisory reasoning, allergy referral, unavailable/unaffordable menus, unknown products and prompt injection. The evaluation-001/evaluation-002 pair preserves one request/menu identity while changing public prices/versions/availability. Both stay in the same held-out group.

Case IDs, groups, complete scenarios and menu UUID families are separated between splits. Train/validation may select/check SFT; evaluation never enters the trainer. Exact duplicate/group checks cannot detect all paraphrase leakage, so new groups need human review. This small corpus demonstrates mechanics, not training readiness or recommendation quality.

Run without ML dependencies:

    pnpm ai:data:validate
    python3 ai/menu-assistant/training/validate_data.py

TypeScript is the authoritative validator/evaluator. The standard-library Python preflight checks public protocol, approved arguments, fixture tool observations, gold consistency and split boundaries; it explicitly reports its limits.

## Raw quality evaluation

A prediction file contains exact rows:

    {"id":"evaluation-001","output":"<last raw model TOOL_CALL or FINAL string>","toolTrace":[{"name":"searchMenu","arguments":{"limit":8},"result":{"products":[],"truncated":false,"asOf":"..."}}]}

The example only illustrates shape; the actual tool result must match independent fixture truth for that case. The notebook records the actual executed reads. It does not replay gold tool calls during inference or copy final answers. A terminal TOOL_CALL, malformed JSON, bad output shape, missing prediction, changed observation or exhausted loop is a failed case.

    pnpm ai:evaluate --predictions path/to/predictions.jsonl --output path/to/report.json

The evaluator measures structured-output success, ID/name grounding with read evidence, hallucinated IDs, public availability, quoted-price accuracy, claimed arithmetic, actual-menu-price budget compliance, explicitly annotated category/product constraints, clarification fields and expected intent. ID grounding and availability are distinct: an existing sold-out dish is not an invented dish. Underquoting a real price does not make an over-budget recommendation pass.

Reports show passed/total/rate and applicable denominators. Missing/malformed cases fail applicable metrics and full-split coverage. Grounding, availability, quoted-price accuracy and arithmetic consistency use recommendation-case denominators, so non-recommendation zero totals do not inflate them. No gold product choice is required when another grounded choice meets the annotated constraints.

Allergy wording/referral checks are a limited proxy. Free-text factuality, subtle hallucinations, natural-language preferences, explanation usefulness, portion suitability and allergy-safety meaning require the supplied human-review rubrics. One run per case cannot measure repeated-run consistency. Prediction provenance is unverified; an input file alone cannot establish that a real model produced it. Dataset validation and unit-test outputs are not model benchmarks.

## Manual Qwen experiment scaffold

The target remains Qwen/Qwen3-4B with its matching unsloth/Qwen3-4B-unsloth-bnb-4bit conversion. Existing requirements are a candidate unvalidated hosted-GPU profile. No dependency installation or model action runs by default. Exact model revision, environment versions, data/policy hashes, template/EOS and run label are recorded when a person explicitly enables an experiment.

The notebook creates one prompt/completion sample for each assistant turn. All preceding system/user/assistant/tool messages are masked context; only that turn's JSON plus EOS is supervised. Independent facts are never tokenized directly. Context overflow fails explicitly. The candidate context is 8192 tokens and output reserve 1536; this revision has not validated GPU memory, tokenizer lengths or model compatibility.

The optional prediction loop starts with only system/user messages and executes at most eight model-selected fixture reads. It preserves generated special tokens and whitespace with decoding cleanup disabled, removes only one exact terminal EOS as transport framing, and records the resulting raw final string and actual toolTrace. Extra EOS markers, thinking tags and spurious tokens remain observable structured-output failures. A context-limit error is retained as a failed raw case. BASE inference and ADAPTER inference use separate run labels and raw prediction files; all install/train/predict/export flags are false. BASE cannot train or export a LoRA adapter.

Save adapter/tokenizer and experiment evidence before optional merged 16-bit/GGUF export. Modelfile.example is only a later import handoff for a complete merged GGUF. Export does not prove serving parity. Compare base/adapter/exported raw outputs on the same held-out scenarios before claiming any improvement.

Primary references retained for the future manual experiment:

- [Qwen3-4B model card](https://huggingface.co/Qwen/Qwen3-4B)
- [Qwen template](https://huggingface.co/Qwen/Qwen3-4B/raw/main/tokenizer_config.json)
- [TRL 0.22.2 SFT](https://huggingface.co/docs/trl/v0.22.2/en/sft_trainer)
- [Unsloth Qwen3 notebook](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_(14B)-Reasoning-Conversational.ipynb)
- [Unsloth GGUF export](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

No model service, customer conversation persistence, automatic training, automatic upload or production enablement is included.
