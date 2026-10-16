# Menu Assistant training foundation

Status: synthetic fixtures and an unexecuted QLoRA SFT notebook. No model weights, model downloads, GPU training, inference, export or quality measurements are included. The shared contract in `packages/contracts/src/menu-assistant.ts` is authoritative; these artifacts are handoff material for a later manual Colab/Kaggle experiment.

The target is the original `Qwen/Qwen3-4B`, using its matching `unsloth/Qwen3-4B-unsloth-bnb-4bit` conversion for memory-efficient SFT. Qwen documents a minimum Transformers version of 4.51 and a hard `enable_thinking=False` prompt switch. Other Qwen3 variants have different behavior and must not be substituted without reviewing the template. [Qwen model card](https://huggingface.co/Qwen/Qwen3-4B)

## Data and behavior

`data/train.jsonl` contains 24 examples, `data/validation.jsonl` 6, and `data/evaluation.jsonl` 6. All 36 are manually curated synthetic scenarios (`source: CURATED_SYNTHETIC`), with UUIDv5 fixture identities and no production/customer records. Every line contains exactly `id`, `groupId`, `scenario`, `source` and three `messages`: the exact shared system policy, a JSON-encoded `AssistantProviderInput`, and a JSON-encoded `AssistantDecision`.

The sets have distinct case IDs, groups, canonical inputs and menu UUID families. Variants of the same runtime scenario stay in one group and split. Train/validation select and check SFT; held-out evaluation is never passed to the trainer. The evaluation pair `evaluation-001` / `evaluation-002` keeps the same request and menu identity while changing prices, product versions and stock, requiring a different grounded recommendation. These small fixtures demonstrate mechanics; grow and review grouped data before treating the corpus as training-ready or using it to draw performance conclusions. Exact duplicate checks cannot detect all paraphrase leakage; keep a human review of new groups.

The model learns response shape, bounded reason codes, clarification, staff referral and runtime grounding. Product prices, stock, names and membership always come from the supplied context. Context has at most eight synthetic products. `RECOMMEND` outputs contain only UUIDs, quantities and reason codes. No model-generated name/price/prose is accepted. Natural messages that state people/budget also carry those structured fields; examples with missing fields request `PEOPLE`, `BUDGET` or both. This scaffold does not add a natural-language extraction step to the application's mock provider.

Diet, spice, proteins, light/shared meals, ingredient avoidance and allergies use `REFER_STAFF` while semantic metadata is `UNREVIEWED`. Category inclusions use the actual contract mapping: `VEGETABLE → RAU-DAU-HU`, `DRINK → DO-UONG`, `DESSERT → TRANG-MIENG`. Unknown requested products, unavailable/unaffordable sets and unrelated tasks use `NO_MATCH`. Injection examples cover a user asking for commands and instructions embedded in menu descriptions; the latter remain inert data. Integer VND is stored as strings and checked with arbitrary-precision arithmetic (`int` in the Python preflight; `BigInt` in the application/evaluator), including an exact budget boundary.

## Local checks without ML dependencies

Run from the repository:

```sh
python3 ai/menu-assistant/training/validate_data.py
```

This standard-library preflight checks record shape, exact shared policy when the contract file is present, split leakage, held-out UUID families, output shape, availability, category coverage, referral/clarification guards and exact integer totals. The repository's TypeScript validator/evaluator supplies the authoritative shared-contract checks and scores raw predictions. A hosted copy missing the shared TypeScript file reports that limitation; run the repository validator before any experiment. Passing fixture checks proves data consistency, not model quality.

## Manual notebook workflow

Open `training/qwen3_4b_qlora_sft.ipynb` with the complete `data/` and `training/` folders. All installation, training, prediction and export switches default to `False`. Dataset validation happens first using only the standard library. Set the exact model repository commit in `MODEL_REVISION` before enabling any model action. No private paths or credentials are required.

The candidate dependency profile pins Unsloth/Zoo 2026.10.5 and the official conversational notebook's Transformers 4.57.6 / TRL 0.22.2 / Datasets 4.3.0 versions; remaining direct dependencies are declared. CUDA/PyTorch/Triton depend on the hosted runtime. This combination is **not GPU-validated** by this change. Inspect installation and `pip check`, restart when necessary, then rerun validation. Each real run records file SHA-256 values, policy/template fingerprints, model revision, package versions, resolved `pip freeze`, GPU/CUDA information and training configuration. [Unsloth notebook](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_(14B)-Reasoning-Conversational.ipynb), [Unsloth release](https://pypi.org/project/unsloth/2026.10.5/), [Zoo release](https://pypi.org/project/unsloth-zoo/2026.10.5/)

Source messages are converted to a prefilled non-thinking prompt and a separate JSON-plus-EOS completion. `completion_only_loss=True` masks the prompt; label inspection checks actual behavior before training. Qwen's template includes an empty thinking prefix, so testing the whole formatted sequence for absence of `<think>` would be wrong. Only generated final content is parsed. Samples exceeding the context length fail rather than being truncated. Evaluation generation also reserves bounded output space. [Qwen template](https://huggingface.co/Qwen/Qwen3-4B/raw/main/tokenizer_config.json), [TRL 0.22.2 SFT](https://huggingface.co/docs/trl/v0.22.2/en/sft_trainer)

Initial settings are rank 16, attention and MLP target modules, one epoch, batch size 1 with gradient accumulation 8, and validation each epoch. These are starting values, not tuned results. The scaffold does not import large generic reasoning datasets, add GRPO, distribute training or introduce a model service into the application. [Unsloth LoRA guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide/lora-hyperparameters-guide)

## Evaluation and serving handoff

Optional generation writes `training/artifacts/manual-run/predictions.jsonl` with exact rows `{ "id": "evaluation-001", "output": "<raw generated content>" }`. Raw malformed responses stay in the file so failures can be counted; unknown, duplicate or missing case IDs are rejected by the writer. The generation cell uses only the first two messages and never copies gold answers. Match case IDs to held-out fixtures in the external TypeScript evaluator. Compare JSON parse/schema validity, grounded IDs/stock/categories/budget, expected decision kind and clarification fields; loss alone is insufficient. Save separate model/run labels for base, adapter and exported model comparisons. No predictions or scores are fabricated here.

Save adapter and tokenizer first. Export a merged 16-bit model and a complete `q4_k_m` GGUF only when explicitly enabled; merging can require more RAM/disk than training. Current upstream Ollama rejects direct LoRA adapters, even though older guides describe `ADAPTER`. Use `training/Modelfile.example` after renaming/copying the actual complete export to `merged-q4_k_m.gguf`, and record the locally tested Ollama version. GGUF is quantized before import. Preserve chat template/EOS, inspect imported thinking metadata, then rerun the same held-out checks after export. Export success is not parity or quality evidence. [Unsloth export](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf), [Ollama import](https://docs.ollama.com/import), [current upstream adapter rejection](https://github.com/ollama/ollama/blob/main/server/create.go)

A future Ollama provider should send the shared decision JSON Schema in `format`, `think: false`, and bounded context/output/timeout, then parse and validate the returned content and recheck current database prices/availability. `/api/show` exposes supported thinking controls; imported custom models can lack that metadata. The application owns user-visible names/prices/totals and every cart/order/payment mutation. No Ollama client, automatic upload or deployment is implemented in this folder. [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Ollama thinking controls](https://docs.ollama.com/capabilities/thinking)

## Base versus adapter experiment

For a base run choose `INFERENCE_VARIANT="BASE"`, `GENERATE_PREDICTIONS=True`, `RUN_TRAINING=False`, `RUN_EXPORT=False`, `ADAPTER_PATH=None` and a new base run label. It loads the same pinned four-bit checkpoint without LoRA and writes raw held-out predictions. For the adapter run choose `INFERENCE_VARIANT="ADAPTER"` and train or explicitly load the saved adapter under a different run label. Compare the two prediction files with the same external evaluator. BASE cannot train or export an adapter. This path is scaffold only and has not loaded a model or measured either model.
