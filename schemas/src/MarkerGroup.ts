import { Colour3, Point, Title } from "./CoreTypes";


type CircleProps = {
    fillColor: Colour3;
    borderColor?: Colour3;
    borderWidth?: number;

    /**
     * @default 5
     */
    size: number;

    extraMinZoomSize?: number;
    icon?: Title;
};


type PinProps = {
    pinColor: Colour3;

    /**
     * @default 32
     */
    size: number;
};


type IconProps = {
    icon: Title;

    /**
     * @default [ 32, 32 ]
     */
    size: number | Point;
};


export type MarkerGroup = {
    /**
     * User-friendly name.
     */
    name: string;

    /**
     * Optional article title all markers in this group should link to.
     */
    article?: string;

    /**
     * Whether this group is visible by default (ticked in the legend) when the map is loaded.
     *
     * @default true
     */
    isDefault: boolean;

    /**
     * Configures the collectibles feature, which allows users to mark markers in this group as collected/visited:
     *
     * - false: Disabled.
     * - true or 'individual': Collected status is tracked per each individual marker only on this map.
     * - 'group': Collected status is tracked for the entire group only on this map (one tick checks the whole group off).
     * - 'globalGroup': Collected status is tracked for every group that has the same ID as this one globally (on all maps on
     *   this wiki).
     *
     * @default false
     */
    isCollectible: boolean | 'individual' | 'group' | 'globalGroup';

    /**
     * Displays ordering numbers next to each marker in the checklist, if collectibles are enabled.
     *
     * @default false
     */
    autoNumberInChecklist: boolean;

    /**
     * Whether this group is included in marker search.
     *
     * @default true
     */
    canSearchFor: boolean;
} & ( CircleProps | IconProps | PinProps );
