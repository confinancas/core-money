import { describe, expect, it } from "vitest";
import { deviceNameFromUserAgent } from "../../../src/shared/device-name";

describe("deviceNameFromUserAgent", () => {
  it("iPhone com Safari", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(deviceNameFromUserAgent(ua)).toBe("iPhone · Safari");
  });

  it("iPad com Safari não vira Mac", () => {
    const ua =
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    expect(deviceNameFromUserAgent(ua)).toBe("iPad · Safari");
  });

  it("Android com Chrome", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    expect(deviceNameFromUserAgent(ua)).toBe("Android · Chrome");
  });

  it("Android com Samsung Internet não vira Chrome", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36";
    expect(deviceNameFromUserAgent(ua)).toBe("Android · Samsung Internet");
  });

  it("Windows com Edge não vira Chrome", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
    expect(deviceNameFromUserAgent(ua)).toBe("Windows · Edge");
  });

  it("Mac com Safari", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
    expect(deviceNameFromUserAgent(ua)).toBe("Mac · Safari");
  });

  it("Linux com Firefox", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
    expect(deviceNameFromUserAgent(ua)).toBe("Linux · Firefox");
  });

  it("sem reconhecer nada, e sem User-Agent, vira Aparelho", () => {
    expect(deviceNameFromUserAgent("curl/8.0")).toBe("Aparelho");
    expect(deviceNameFromUserAgent(undefined)).toBe("Aparelho");
    expect(deviceNameFromUserAgent(null)).toBe("Aparelho");
  });

  it("nunca passa de 60 caracteres", () => {
    expect(deviceNameFromUserAgent(`Windows ${"x".repeat(200)}`).length).toBeLessThanOrEqual(60);
  });
});
