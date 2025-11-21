<template>
    <div class="page flex-column">
        <bubble-filter @on-time-change="onFilterTimeChange" @on-query="onClickQuery">
            <template #option>
                <el-button size="small">
                    <a href="/docs/AOI-sop.pptx" download="AOI-sop.pptx">下载SOP</a>
                </el-button>
            </template>
        </bubble-filter>
        <div class="table-container">
            <el-table :data="waferAoiList" style="width: 80%" size="small" @row-click="handleRowClick">
                <el-table-column prop="measureTime" label="Measure Time" :formatter="formatMeasureTime" />
                <el-table-column prop="product" label="Product" />
                <el-table-column prop="layerId" label="Layer ID" />
                <el-table-column prop="inspEqp" label="Inspection Eqp" />
                <el-table-column prop="lot" label="Lot ID" />
                <el-table-column prop="wafer" label="Wafer ID" />
<!--                 <el-table-column prop="centerX" label="cx" />
                <el-table-column prop="centerY" label="cy" />
                <el-table-column prop="sizeX" label="sx" />
                <el-table-column prop="sizeY" label="sy" />
                <el-table-column prop="recipeKey" label="rkey" />
                <el-table-column prop="waferKey" label="wkey" /> -->
            </el-table>
        </div>
        <WaferDefectChart :wafer-list="waferAoiList" />
        <div v-if="false" style="margin-top: 20px;">
            <h3>缺陷原始数据 ({{ defectRawList.length }} 条)</h3>
            <el-table :data="defectRawList" style="width: 80%" size="small">
                <el-table-column prop="waferX" label="WAFER_X" />
                <el-table-column prop="waferY" label="WAFER_Y" />
                <el-table-column prop="defectId" label="DEFECT_ID" />
                <el-table-column prop="indexX" label="INDEX_X" />
                <el-table-column prop="indexY" label="INDEX_Y" />
                <el-table-column prop="waferKey" label="wkey" />
            </el-table>
        </div>
        <div v-if="defectRawList.length > 0" style="padding:20px;">
            <WaferCanvas 
                :key="selectedWaferRow?.waferKey || 'default'"
                :radius="150000" 
                :dieWidth="Number(selectedWaferRow.sizeX)" 
                :dieHeight="Number(selectedWaferRow.sizeY)"
                :offsetX="Number(selectedWaferRow.centerX)" 
                :offsetY="Number(selectedWaferRow.centerY)" 
                :viewSize="800" 
                :defectPoints="defectPoints"
                :waferKey="selectedWaferRow.waferKey" 
                :waferInfo="waferInfo"
            />
        </div>
    </div>
</template>

<script setup>
import {
    provide,
    ref,
    shallowRef,
    shallowReactive,
    onMounted,
    nextTick,
} from "vue";
import BubbleFilter from "@/components/filter.vue";
import { fetchOptions, fetchWaferAoiList, fetchDefectRawData } from "@/apis/aoi.js";
import { formatDate } from "@/utils/time.js";
import WaferCanvas from './wafercanvas.vue'
import WaferDefectChart from './wafer-defect-chart.vue'

// 添加waferInfo响应式变量
const waferInfo = ref({});

const now = new Date();
const start = new Date(now.valueOf() - 1000 * 60 * 60 * 24 * 7);

const filter = shallowReactive({
    startTime: formatDate(start),
    endTime: formatDate(now),
    product: "",
    layer: "",
    eqp: "",
    lot: "",
    wafer: "",
});
/** @type {import('vue').ShallowRef<OptionData[]>} */
const options = shallowRef([]);
/** @type {import('vue').ShallowRef<Wafer[]>} */
const waferAoiList = shallowRef([]);
const defectRawList = ref([]);
const selectedWaferRow = ref(null);
const defectPoints = ref([]);

provide("filter", filter);
provide("options", options);

async function onFilterTimeChange() {
    await getOptions();
}

async function onClickQuery() {
    await getWaferAoiList();
}

async function getOptions() {
    const resData = await fetchOptions(filter.startTime, filter.endTime);
    options.value = resData;
}

async function getWaferAoiList() {
    const resData = await fetchWaferAoiList(
        filter.startTime,
        filter.endTime,
        filter.product,
        filter.layer,
        filter.eqp,
        filter.lot,
        filter.wafer
    );
    waferAoiList.value = resData;
}

async function handleRowClick(row) {
    selectedWaferRow.value = row;
    defectPoints.value = [];
    try {
        const resData = await fetchDefectRawData(row.waferKey);
        defectRawList.value = resData;
        defectPoints.value = resData.map(item => ({
            x: Number(item.waferX),
            y: Number(item.waferY),
            defect_id: item.defectId,
            index_x: item.indexX,
            index_y: item.indexY
        }));
        
        // 构建waferInfo对象
        waferInfo.value = {
            scanTime: formatMeasureTime(null, null, row.measureTime), // 使用已有的格式化函数
            product: row.product,
            layerId: row.layerId,
            inspectionEqp: row.inspEqp,
            lotId: row.lot,
            waferId: row.wafer,
            defectCount: resData.length
        };
    } catch (error) {
        console.error("Failed to fetch defect raw data:", error);
        defectRawList.value = [];
        // 即使获取缺陷数据失败，也要设置基本的waferInfo
        waferInfo.value = {
            scanTime: formatMeasureTime(null, null, row.measureTime),
            product: row.product,
            layerId: row.layerId,
            inspectionEqp: row.inspEqp,
            lotId: row.lot,
            waferId: row.wafer,
            defectCount: 0
        };
    }
}

function formatMeasureTime(row, column, cellValue) {
  if (!cellValue) return '';
  // 如果包含T，则替换，并去掉毫秒部分
  if (cellValue.includes('T')) {
    return cellValue.replace('T', ' ').split('.')[0];
  }
  return cellValue;
}

onMounted(() => {
    getOptions();
});
</script>

<style scoped>
:deep(.el-table) {
    height: 400px;
    overflow-y: auto;
    margin: 20px auto;
}
.table-container {
    height: 400px; /* 固定高度 */
    flex-shrink: 0; /* 在flex布局中不收缩 */
    margin: 20px auto; /* 保持和原来一样的边距 */
    width: 80%; /* 和表格宽度一致 */
}
</style>