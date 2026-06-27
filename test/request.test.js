import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { sendJsonRequest } from "../src/request.js";

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC8GWjKpjJ4lP4a
W5kXWAX3ztCv2Nkj1/nZfgSCSkxBrdy1aTuj4ZvWpdsgdefQ0v5OIz/PXjGuxJmT
yUEdrnRwE7Ya8qrWFXhFp4SXIxtZFs1AncP5MuBu8+8w9GF6grkkVNZPXHVQBw4Q
3Y2C1WuMkrggzhOv0wLJjhjCv5IA2rI+oJ17RvIxfM36pp6NGcHrqDErFkewG8aZ
zrTJp128Ygec5y3DPPHOX/tqv61GOu1yuMPG9PBxeTSUIVCem6efCsAwSN4dqCb8
3GAgs3FqML2CLqFhYOD2bScESP1DwVsVl9ac1yMy/JwYiyvwTk3w+07SaK/a0ZZl
0NN1nOohAgMBAAECggEAEI+EJGNhijBD9vodjmqXi+vPf8vtwjQfsUBhET+NWzL9
fZNYRuN0Hv/XPRJkaIRLE4IS+iTm5uY0R0iuzPgxFDUIEXNQCy00u502FUBoBf31
8DxzppsOG3aqlnrNokWkG0jE3ZPcWEFmwaFf9iboIyY/w9Og9Bf15Nz33R2UszJn
O5YIu5+QObYktW6/N2YClCce2QMle2I/6LHpr1HdIR+9QQgS61YsTadw/9U3TvXD
BU2nFNhX0Pme8BhbqYUNlsPLWUYOq+2RnbIdHEGVe8dkLW5g78MNpS769SVsAUiZ
ZC372rNOLX/tFi1Qa26OewxTYeYIgMg/msc/cEOu4QKBgQDu28QtSGO0l5j4vdkv
EwDi3EwhaCQ147tRO5vED94X0cbi1KGBP5WGdg00o7cloWRcDfE+lmweQQAW8HCx
D3hxlnxrLCI3NnK/7e5P3JirVjGeplAKY5ArK3Z6fsWQowPsMZlFgpixx2WWPa76
U3kred55gocLUkv2/7KcNJOnDQKBgQDJmRxQLkKjJV1hi8z2hmB7OeB/j77vs12P
xN+DQtAV9K7qLuEjthh7xMTFkUAdr8s18xSGaOgXyaeHKGE3Y82fGoH+L6hLxewg
uWbLvw9tXx28alpbzJFhN9A+1vSCmlMCmXwgBiNtvxW1z8Agit1kDtA8aXaFng0a
hG1ySMuKZQKBgELT+e8xcbP1Njdh5oHlLzpJqIMwP/FT5fS0WMBiMCE58AtGsmkX
AR69qLQxmexNW2bl/7kjHNzaEsxYOS9QxMIC+IyDrI8GDNTmHOb7MTu+weNBZOOD
N7LcVimvjlcJRO+wcNGh2FblEucWGv6unBgt4LDedCoWvGo+4BoUG7uBAoGAdOqP
OREbJHLvDTt+yxpzqgOO52v+WBW2FUMgPYfqFlGpf7dgas2YtW8Qj2QFwzHIsKkh
JjKBKAqTVhddCjqfbb551WjeOdO3deMQcumDkPKw1Cz56nNhfPhZlZgkhfnqWn+Z
NRlaQrOna6Ho0va2HulYazDew+89ujtDHhyJruECgYEAlKjJeH/h5k1WFR7Bhot+
XTiQVZhJERDCrJMvcJd6vPqbTRNPXMsIfMMulq8c6uJ+SKn7Sf6pT3mgTqLSBoup
jJp/KMcrxocikl7I4hNJbD5Rll5gRfqbEkDfepgzlTET9I0OJuktS3MojydFUOQB
WYni6S95nEcbil278qvyr1A=
-----END PRIVATE KEY-----`;

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQCh8XP9Fpe+7zANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjYwNjI3MDUwMDExWhcNMjYwNjI4MDUwMDExWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8
GWjKpjJ4lP4aW5kXWAX3ztCv2Nkj1/nZfgSCSkxBrdy1aTuj4ZvWpdsgdefQ0v5O
Iz/PXjGuxJmTyUEdrnRwE7Ya8qrWFXhFp4SXIxtZFs1AncP5MuBu8+8w9GF6grkk
VNZPXHVQBw4Q3Y2C1WuMkrggzhOv0wLJjhjCv5IA2rI+oJ17RvIxfM36pp6NGcHr
qDErFkewG8aZzrTJp128Ygec5y3DPPHOX/tqv61GOu1yuMPG9PBxeTSUIVCem6ef
CsAwSN4dqCb83GAgs3FqML2CLqFhYOD2bScESP1DwVsVl9ac1yMy/JwYiyvwTk3w
+07SaK/a0ZZl0NN1nOohAgMBAAEwDQYJKoZIhvcNAQELBQADggEBADvi/ut6kcMT
ytRkmXFVC3xYtTrvJtqzkTkoROuHQ0piAry/Z2AEmPUA1jsXRLlLJyT4TWQmfv/b
2gsaUAGdapMFwhAF6oY/smTf8+crltWZctAUe45T41UaKsKrwzaSTJfrxJUQV0uF
Onc4ckQwdZe1L8DXE9X+fGTgBGtrO5i+0X3U2l8NWCE39X2667vp5h4JAr4SypMQ
n6O1dCbB8b+LNp062s8ngupGKRur9pl9qivCiEqwVwFvQm5jHhMf0Vxv4dty1xpq
gTeo0w53NsABceUEMwnrd1wQf4vzYyBF5MODZTRP2acQ5x2ymJyE8cJipVMm0HXz
e45ho2iPua8=
-----END CERTIFICATE-----`;

test("sendJsonRequest accepts self-signed TLS when insecureTLS is enabled", async () => {
  const server = https.createServer({ key: TEST_KEY, cert: TEST_CERT }, (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const data = await sendJsonRequest({
      url: `https://127.0.0.1:${port}/`,
      method: "GET",
      headers: {},
      insecureTLS: true
    });
    assert.deepEqual(data, { ok: true });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
