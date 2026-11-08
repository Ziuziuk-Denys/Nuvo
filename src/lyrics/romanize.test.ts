import { describe, expect, it } from "vitest";
import { romanizeChinese, romanizeKana, romanizeKorean, romanizerFor } from "./romanize";

describe("Korean", () => {
  it.each([
    ["한국어", "hangugeo"],
    ["안녕하세요", "annyeonghaseyo"],
    ["사랑해", "saranghae"],
    ["좋아", "joa"],
    ["있어", "isseo"],
    ["먹어", "meogeo"],
    ["읽어", "ilgeo"],
    ["몫이", "moksi"],
    ["신라", "silla"],
    ["설날", "seollal"],
    ["독립", "dongnip"],
    ["심리", "simni"],
    ["국물", "gungmul"],
    ["값", "gap"],
    ["아이", "ai"],
  ])("%s is %s", (text, expected) => {
    expect(romanizeKorean(text)).toBe(expected);
  });

  it("keeps spaces, Latin letters and punctuation, and starts a new word after a space", () => {
    expect(romanizeKorean("나는 love, 너는?")).toBe("naneun love, neoneun?");
    expect(romanizeKorean("집 안")).toBe("jip an");
  });
});

describe("Chinese", () => {
  it("writes pinyin without tones, one word per character, and leaves other text alone", () => {
    expect(romanizeChinese("我爱你")).toBe("wo ai ni");
    expect(romanizeChinese("月亮 moon, 你好!")).toBe("yue liang moon, ni hao!");
  });
});

describe("Japanese kana", () => {
  it.each([
    ["さよなら", "sayonara"],
    ["ありがとう", "arigatou"],
    ["きょう", "kyou"],
    ["ちょっと", "chotto"],
    ["まっちゃ", "matcha"],
    ["きっぷ", "kippu"],
    ["しんゆう", "shin'yuu"],
    ["こんにちは", "konnichiha"],
    ["ラーメン", "raamen"],
    ["コーヒー", "koohii"],
    ["パーティー", "paatii"],
    ["ファン", "fan"],
    ["ヴァイオリン", "vaiorin"],
    ["じゃあね", "jaane"],
  ])("%s is %s", (text, expected) => {
    expect(romanizeKana(text)).toBe(expected);
  });

  it("keeps kanji, Latin letters, spaces and marks, a space between kana and other words", () => {
    expect(romanizeKana("夜に駆ける")).toBe("夜 ni 駆 keru");
    expect(romanizeKana("I love you だよ!")).toBe("I love you dayo!");
    expect(romanizeKana("君のことが好き、ずっと")).toBe("君 nokotoga 好 ki、zutto");
  });
});

describe("which romanizer a song gets", () => {
  it("Hangul gets Korean, Han alone gets Chinese", () => {
    expect(romanizerFor(["안녕", "hello"])?.("안녕")).toBe("annyeong");
    expect(romanizerFor(["我爱你"])?.("我爱你")).toBe("wo ai ni");
  });

  it("kana means Japanese, romanized kana only; Latin and Cyrillic have nothing to romanize", () => {
    expect(romanizerFor(["夜に駆ける", "さよなら"])).toBe(romanizeKana);
    // a kanji-only line of a Japanese song never gets a Chinese reading
    expect(romanizerFor(["漢字だけ", "日本語"])?.("日本語")).toBe("日本語");
    expect(romanizerFor(["just english", "привет"])).toBeNull();
  });

  it("returns the text itself as no change when a line has nothing to convert", () => {
    expect(romanizerFor(["안녕"])?.("hello")).toBe("hello");
  });
});
