from stages.translate import translate_lines


class StubTokenizer:
    """Mimics MarianTokenizer's call surface: __call__ then batch_decode."""

    def __call__(self, texts, return_tensors, padding, truncation):
        assert return_tensors == "pt" and padding and truncation
        self.seen_texts = list(texts)
        return {"input_ids": list(texts)}

    def batch_decode(self, outputs, skip_special_tokens):
        assert skip_special_tokens
        return [f"EN:{t}" for t in outputs]


class StubModel:
    def generate(self, input_ids):
        self.called_with = list(input_ids)
        return list(input_ids)


def make_line(n, text):
    return {
        "lineNumber": n,
        "originalText": text,
        "translatedText": None,
        "startTime": float(n),
        "endTime": float(n) + 1.0,
        "words": [{"text": text.split()[0], "start": float(n), "end": float(n) + 0.5}],
    }


def test_translate_lines_fills_translated_text_in_order():
    lines = [make_line(1, "Prima linie"), make_line(2, "A doua linie")]
    tokenizer, model = StubTokenizer(), StubModel()

    result = translate_lines(lines, tokenizer, model)

    assert result is lines  # same list, filled in place
    assert lines[0]["translatedText"] == "EN:Prima linie"
    assert lines[1]["translatedText"] == "EN:A doua linie"
    assert tokenizer.seen_texts == ["Prima linie", "A doua linie"]


def test_translate_lines_batches_all_lines_in_one_call():
    lines = [make_line(i, f"linia {i}") for i in range(1, 6)]
    model = StubModel()

    translate_lines(lines, StubTokenizer(), model)

    assert model.called_with == [f"linia {i}" for i in range(1, 6)]  # one batch, all lines


def test_translate_lines_preserves_all_other_fields():
    lines = [make_line(1, "Prima linie")]
    original_words = [dict(w) for w in lines[0]["words"]]

    translate_lines(lines, StubTokenizer(), StubModel())

    assert lines[0]["lineNumber"] == 1
    assert lines[0]["originalText"] == "Prima linie"
    assert lines[0]["startTime"] == 1.0
    assert lines[0]["endTime"] == 2.0
    assert lines[0]["words"] == original_words


def test_translate_lines_empty_input_returns_empty_without_model_call():
    model = StubModel()

    result = translate_lines([], StubTokenizer(), model)

    assert result == []
    assert not hasattr(model, "called_with")
