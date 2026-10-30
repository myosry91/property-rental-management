import { createHmac } from "node:crypto";

const billId = "a1689fd1-906e-454a-8539-7bf021fd9326";
const secret = process.env.GATEWAY_X_SIGNATURE_KEY;

if (!secret) {
  throw new Error("Missing GATEWAY_X_SIGNATURE_KEY");
}

const fields: Record<string, string> = {
  id: billId,
  paid: "true",
  paid_amount: "627419",
  paid_at: "2026-10-30 10:00:00 +0800",
  transaction_id: "TX-TEST-001",
  transaction_status: "success",
};

const payload = Object.keys(fields)
  .sort()
  .map((key) => `${key}${fields[key]}`)
  .join("|");

const signature = createHmac("sha256", secret).update(payload).digest("hex");

const body = new URLSearchParams({
  ...fields,
  x_signature: signature,
});

async function main() {
  const response = await fetch("http://localhost:3000/api/webhooks/gateway", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  console.log("Status:", response.status);
  console.log("Response:", await response.json());
}

main();
