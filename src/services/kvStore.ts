import type {
	KVNamespace,
	KVNamespaceGetOptions,
	KVNamespacePutOptions,
} from "@cloudflare/workers-types";

export class KVCache {
	#kv: KVNamespace;
	#prefix: string;
	constructor(prefix: string, kv: KVNamespace) {
		this.#kv = kv;
		this.#prefix = prefix;
	}
	#combineKeys(keys: string[]): string {
		return [this.#prefix, ...keys].filter((k) => !!k).join(":");
	}
	async get(key = ""): Promise<string | null> {
		return this.#kv.get(this.#combineKeys([key]));
	}
	async put(
		key: string,
		value: string | ArrayBuffer | ArrayBufferView,
		options?: KVNamespacePutOptions,
	) {
		return this.#kv.put(this.#combineKeys([key]), value, options);
	}
}
