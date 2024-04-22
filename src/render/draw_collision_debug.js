// @flow

import DepthMode from '../gl/depth_mode.js';
import StencilMode from '../gl/stencil_mode.js';
import CullFaceMode from '../gl/cull_face_mode.js';
import {collisionUniformValues, collisionCircleUniformValues} from './program/collision_program.js';
import {QuadTriangleArray, CollisionCircleLayoutArray} from '../data/array_types.js';
import {collisionCircleLayout} from '../data/bucket/symbol_attributes.js';
import SegmentVector from '../data/segment.js';
import {mat4} from 'gl-matrix';
import {getCollisionDebugTileProjectionMatrix} from '../geo/projection/projection_util.js';
import VertexBuffer from '../gl/vertex_buffer.js';
import IndexBuffer from '../gl/index_buffer.js';

import type Painter from './painter.js';
import type SourceCache from '../source/source_cache.js';
import type StyleLayer from '../style/style_layer.js';
import type {OverscaledTileID} from '../source/tile_id.js';
import type SymbolBucket from '../data/bucket/symbol_bucket.js';
import type Projection from '../geo/projection/projection.js';

export default drawCollisionDebug;

type TileBatch = {
    circleArray: Array<number>,
    circleOffset: number,
    transform: Float32Array,
    invTransform: Float32Array,
    projection: Projection
};

let quadTriangles: ?QuadTriangleArray;

function drawCollisionDebug(painter: Painter, sourceCache: SourceCache, layer: StyleLayer, coords: Array<OverscaledTileID>, translate: [number, number], translateAnchor: 'map' | 'viewport', isText: boolean) {
    const context = painter.context;
    const gl = context.gl;
    const tr = painter.transform;
    const program = painter.getOrCreateProgram('collisionBox');
    const tileBatches: Array<TileBatch> = [];
    let circleCount = 0;
    let circleOffset = 0;

    for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const tile = sourceCache.getTile(coord);
        const bucket: ?SymbolBucket = (tile.getBucket(layer): any);
        if (!bucket) continue;

        const tileMatrix = getCollisionDebugTileProjectionMatrix(coord, bucket, tr);

        let posMatrix = tileMatrix;
        if (translate[0] !== 0 || translate[1] !== 0) {
            posMatrix = painter.translatePosMatrix(tileMatrix, tile, translate, translateAnchor);
        }
        const buffers = isText ? bucket.textCollisionBox : bucket.iconCollisionBox;
        // Get collision circle data of this bucket
        const circleArray: Array<number> = bucket.collisionCircleArray;
        if (circleArray.length > 0) {
            // We need to know the projection matrix that was used for projecting collision circles to the screen.
            // This might vary between buckets as the symbol placement is a continous process. This matrix is
            // required for transforming points from previous screen space to the current one
            const invTransform = mat4.create();
            const transform = posMatrix;

            mat4.mul(invTransform, bucket.placementInvProjMatrix, tr.glCoordMatrix);
            mat4.mul(invTransform, invTransform, bucket.placementViewportMatrix);

            tileBatches.push({
                circleArray,
                circleOffset,
                transform,
                invTransform,
                projection: bucket.getProjection()
            });

            circleCount += circleArray.length / 4;  // 4 values per circle
            circleOffset = circleCount;
        }
        if (!buffers) continue;
        if (painter.terrain) painter.terrain.setupElevationDraw(tile, program);
        program.draw(painter, gl.LINES,
            DepthMode.disabled, StencilMode.disabled,
            painter.colorModeForRenderPass(),
            CullFaceMode.disabled,
            collisionUniformValues(posMatrix, tr, tile, bucket.getProjection()),
            layer.id, buffers.layoutVertexBuffer, buffers.indexBuffer,
            buffers.segments, null, tr.zoom, null,
            [buffers.collisionVertexBuffer, buffers.collisionVertexBufferExt]);
    }

    if (!isText || !tileBatches.length) {
        return;
    }

    // Render collision circles
    const circleProgram = painter.getOrCreateProgram('collisionCircle');

    // Construct vertex data
    const vertexData = new CollisionCircleLayoutArray();
    vertexData.resize(circleCount * 4);
    vertexData._trim();

    let vertexOffset = 0;

    for (const batch of tileBatches) {
        for (let i = 0; i < batch.circleArray.length / 4; i++) {
            const circleIdx = i * 4;
            const x = batch.circleArray[circleIdx + 0];
            const y = batch.circleArray[circleIdx + 1];
            const radius = batch.circleArray[circleIdx + 2];
            const collision = batch.circleArray[circleIdx + 3];

            // 4 floats per vertex, 4 vertices per quad
            vertexData.emplace(vertexOffset++, x, y, radius, collision, 0);
            vertexData.emplace(vertexOffset++, x, y, radius, collision, 1);
            vertexData.emplace(vertexOffset++, x, y, radius, collision, 2);
            vertexData.emplace(vertexOffset++, x, y, radius, collision, 3);
        }
    }
    if (!quadTriangles || quadTriangles.length < circleCount * 2) {
        quadTriangles = createQuadTriangles(circleCount);
    }

    const indexBuffer: IndexBuffer = context.createIndexBuffer(quadTriangles, true);
    const vertexBuffer: VertexBuffer = context.createVertexBuffer(vertexData, collisionCircleLayout.members, true);

    // Render batches
    for (const batch of tileBatches) {
        const uniforms = collisionCircleUniformValues(batch.transform, batch.invTransform, tr, batch.projection);

        circleProgram.draw(
            painter,
            gl.TRIANGLES,
            DepthMode.disabled,
            StencilMode.disabled,
            painter.colorModeForRenderPass(),
            CullFaceMode.disabled,
            uniforms,
            layer.id,
            vertexBuffer,
            indexBuffer,
            SegmentVector.simpleSegment(0, batch.circleOffset * 2, batch.circleArray.length, batch.circleArray.length / 2),
            null,
            tr.zoom);
    }

    vertexBuffer.destroy();
    indexBuffer.destroy();
}

function createQuadTriangles(quadCount: number): QuadTriangleArray {
    const triCount = quadCount * 2;
    const array = new QuadTriangleArray();

    array.resize(triCount);
    array._trim();

    // Two triangles and 4 vertices per quad.
    for (let i = 0; i < triCount; i++) {
        const idx = i * 6;

        array.uint32[idx + 0] = i * 4 + 0;
        array.uint32[idx + 1] = i * 4 + 1;
        array.uint32[idx + 2] = i * 4 + 2;
        array.uint32[idx + 3] = i * 4 + 2;
        array.uint32[idx + 4] = i * 4 + 3;
        array.uint32[idx + 5] = i * 4 + 0;
    }

    return array;
}
