"""Translation stage: Helsinki-NLP MarianMT, line-by-line (Phase 1.3).

Fills the translatedText slots in the section 6.2 line dicts produced by
stages/transcribe.py, preserving the shape for later phases. Model naming
follows Helsinki-NLP/opus-mt-{source}-{target}; a nonexistent pair fails
clearly at load time.
"""
from transformers import MarianMTModel, MarianTokenizer


def load_translator(source_lang: str = "ro", target_lang: str = "en"):
    model_name = f"Helsinki-NLP/opus-mt-{source_lang}-{target_lang}"
    tokenizer = MarianTokenizer.from_pretrained(model_name)
    model = MarianMTModel.from_pretrained(model_name)
    return tokenizer, model


def translate_lines(lines: list[dict], tokenizer, model) -> list[dict]:
    if not lines:
        return lines
    texts = [line["originalText"] for line in lines]
    # One batched generate() call instead of a per-line loop - meaningfully
    # faster for zero added complexity.
    batch = tokenizer(texts, return_tensors="pt", padding=True, truncation=True)
    translated = model.generate(**batch)
    outputs = tokenizer.batch_decode(translated, skip_special_tokens=True)
    for line, translation in zip(lines, outputs):
        line["translatedText"] = translation
    return lines
