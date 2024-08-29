export type VerticalAlignValue =
	| "baseline"
	| "sub"
	| "super"
	| "top"
	| "middle"
	| "bottom"
	| "text-top"
	| "text-bottom"
	| "initial"
	| "inherit"
	| "revert"
	| "revert-layer"
	| "unset"
	| string;

export interface IconProps {
	verticalAlign?: VerticalAlignValue;
	height?: string;
	label: string;
}
