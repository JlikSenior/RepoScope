import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");

const text = "Hello world";

const tokens = encoding.encode(text);

console.log("Text:", text);
console.log("Token IDs:", tokens);
console.log("Token count:", tokens.length);