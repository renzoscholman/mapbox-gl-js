// @flow

import {
    LineIndexArray,
    TriangleIndexArray,
    LineStripIndexArray
} from './array_types.js';

/**
 * An index array stores Uint32 indices of vertexes in a corresponding vertex array. We use
 * three kinds of index arrays: arrays storing groups of three indices, forming triangles;
 * arrays storing pairs of indices, forming line segments; and arrays storing single indices,
 * forming a line strip.
 * @private
 */
export {LineIndexArray, TriangleIndexArray, LineStripIndexArray};
