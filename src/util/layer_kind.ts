/**
 * What sort of layer a managed layer holds.
 *
 * The live site is minified, so a layer's class name is a letter or two there
 * ("Gr", "Xm") and never contains "Segmentation": a test on constructor.name
 * alone works on a development build and silently finds nothing in production.
 * The layer's own type string ("image", "segmentation", "annotation") survives
 * minifying, so it is the real signal and the class name is only an extra.
 */
export type LayerKind = 'segmentation' | 'image' | 'annotation';

const CLASS_HINT: Record<LayerKind, string> = {
  segmentation: 'Segmentation',
  image: 'Image',
  annotation: 'Annotation',
};

export function isLayerKind(ml: any, kind: LayerKind): boolean {
  const l = ml?.layer;
  if (!l) return false;
  if (l.type === kind || l.constructor?.type === kind) return true;
  const cn = l.constructor?.name;
  return typeof cn === 'string' && cn.includes(CLASS_HINT[kind]);
}

export const isSegLayer = (ml: any): boolean => isLayerKind(ml, 'segmentation');
export const isAnnotationLayer = (ml: any): boolean => isLayerKind(ml, 'annotation');
export const isImageLayer = (ml: any): boolean => isLayerKind(ml, 'image');
