import type {
	Api,
	ClassifierApi,
	ClassifierModel,
	ImageApi,
	ImageModel,
	Model,
	ModelType,
	ProviderId,
} from "./types.ts";

export type ModelGroups = Record<string, Record<string, object>>;

type ModelKey<TGroups extends ModelGroups> = {
	[TApi in keyof TGroups]: keyof TGroups[TApi];
}[keyof TGroups] &
	string;

type KeyForType<TGroups extends ModelGroups, TType extends ModelType> = Extract<
	ModelKey<TGroups>,
	`${TType}:${string}`
>;

type ModelId<TKey extends string> = TKey extends `${ModelType}:${infer TModelId}` ? TModelId : never;

type ApiForKey<TGroups extends ModelGroups, TKey extends ModelKey<TGroups>> = {
	[TApi in keyof TGroups]: TKey extends keyof TGroups[TApi] ? TApi : never;
}[keyof TGroups];

export type ChatModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "chat"> as ModelId<TKey>]: Model<ApiForKey<TGroups, TKey> & Api> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

export type ImageModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "image"> as ModelId<TKey>]: ImageModel<ApiForKey<TGroups, TKey> & ImageApi> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

export type ClassifierModelCatalog<TGroups extends ModelGroups, TProvider extends ProviderId> = {
	[TKey in KeyForType<TGroups, "classifier"> as ModelId<TKey>]: ClassifierModel<
		ApiForKey<TGroups, TKey> & ClassifierApi
	> & {
		id: ModelId<TKey>;
		provider: TProvider;
	};
};

/**
 * One provider's generated models (`providers/data/<provider>.json`), built when they are first asked for: a start builds
 * the catalogs of the providers it uses, not all of them. Each record is built once and keeps its model objects.
 */
export interface LazyModelCatalog<TProvider extends ProviderId, TGroups extends ModelGroups> {
	readonly provider: TProvider;
	/** Chat models by id, in catalog order. */
	chat(): ChatModelCatalog<TGroups, TProvider>;
	/** Image models by id, in catalog order. */
	image(): ImageModelCatalog<TGroups, TProvider>;
	/** Classifier models by id, in catalog order. */
	classifier(): ClassifierModelCatalog<TGroups, TProvider>;
	/**
	 * The chat models' ids and names, in `chat()` order, without building the models: id and name of the first model, then
	 * of the second, and so on.
	 */
	chatNames(): readonly string[];
	/** Whether the models have been built. */
	isBuilt(): boolean;
}

/**
 * `load` returns the provider's models grouped by API and keyed by `type:id` (the data file's layout), a new object at each
 * call; `chatNames` returns the chat models' ids and names in the order `chat()` lists them.
 */
export function lazyModelCatalog<const TProvider extends ProviderId, TGroups extends ModelGroups>(
	provider: TProvider,
	chatNames: () => readonly string[],
	load: () => TGroups,
): LazyModelCatalog<TProvider, TGroups> {
	let byType: Record<ModelType, Record<string, object>> | undefined;
	let names: readonly string[] | undefined;
	// The three records from one pass over the groups: each type's models in the order the groups list them.
	const built = (): Record<ModelType, Record<string, object>> => {
		if (byType) return byType;
		const entries: Record<ModelType, [string, object][]> = { chat: [], image: [], classifier: [] };
		for (const models of Object.values(load())) {
			for (const model of Object.values(models)) {
				const type = (model as { type?: unknown }).type;
				if (type === "chat" || type === "image" || type === "classifier") {
					entries[type].push([(model as { id: string }).id, model]);
				}
			}
		}
		byType = {
			chat: Object.fromEntries(entries.chat),
			image: Object.fromEntries(entries.image),
			classifier: Object.fromEntries(entries.classifier),
		};
		return byType;
	};
	return {
		provider,
		chat: () => built().chat as ChatModelCatalog<TGroups, TProvider>,
		image: () => built().image as ImageModelCatalog<TGroups, TProvider>,
		classifier: () => built().classifier as ClassifierModelCatalog<TGroups, TProvider>,
		chatNames: () => {
			names ??= chatNames();
			return names;
		},
		isBuilt: () => byType !== undefined,
	};
}
