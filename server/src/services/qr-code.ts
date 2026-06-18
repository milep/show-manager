import encodeQR from "@paulmillr/qr";

export function renderQrGif(text: string) {
  return Buffer.from(
    encodeQR(text, "gif", {
      ecc: "medium",
      encoding: "alphanumeric",
      scale: 24,
      border: 4,
    }),
  );
}
