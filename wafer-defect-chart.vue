<template>
  <div class="defect-chart-panel">
    <h3>Wafer 缺陷折线图</h3>
    <p class="chart-hint">按 waferKey 展示缺陷点（按数据顺序绘制，有值的点才会显示）。</p>
    <div class="chart-list" v-if="chartSeries.length">
      <div
        class="chart-item"
        v-for="series in chartSeries"
        :key="series.waferKey"
      >
        <div class="chart-header">
          <span class="chart-title">WaferKey: {{ series.waferKey }}</span>
          <span class="chart-count">有效缺陷点: {{ series.data.length }}</span>
        </div>
        <canvas
          :ref="el => setCanvasRef(el, series.waferKey)"
          class="defect-chart-canvas"
        ></canvas>
      </div>
    </div>
    <div v-else class="empty-placeholder">暂无可绘制的 wafer 数据</div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, watch, ref } from 'vue'
import { fetchDefectRawData } from '@/apis/aoi.js'

const props = defineProps({
  waferList: {
    type: Array,
    default: () => []
  }
})

const canvasMap = ref(new Map())
const chartSeries = ref([])

const setCanvasRef = (el, waferKey) => {
  if (el) {
    canvasMap.value.set(waferKey, el)
  } else {
    canvasMap.value.delete(waferKey)
  }
}

const normalizeDefects = (rawList = []) => {
  return rawList
    .map((item, index) => {
      const x = Number(item.waferX)
      const y = Number(item.waferY)
      if (Number.isNaN(x) || Number.isNaN(y)) return null
      return { index, x, y }
    })
    .filter(Boolean)
}

const fetchSeries = async () => {
  if (!props.waferList || props.waferList.length === 0) {
    chartSeries.value = []
    return
  }

  const tasks = props.waferList.map(async wafer => {
    const waferKey = wafer.waferKey
    try {
      const rawData = await fetchDefectRawData(waferKey)
      return { waferKey, data: normalizeDefects(rawData) }
    } catch (err) {
      console.error(`获取 wafer ${waferKey} 缺陷数据失败:`, err)
      return { waferKey, data: [] }
    }
  })

  const result = await Promise.all(tasks)
  chartSeries.value = result.filter(item => item.data.length > 0)
  drawAllCharts()
}

const drawAllCharts = () => {
  chartSeries.value.forEach(series => {
    const cvs = canvasMap.value.get(series.waferKey)
    if (!cvs) return
    drawChart(cvs, series.data)
  })
}

const drawChart = (cvs, data) => {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = cvs.clientWidth || 500
  const cssHeight = cvs.clientHeight || 220
  cvs.width = cssWidth * dpr
  cvs.height = cssHeight * dpr
  const ctx = cvs.getContext('2d')
  if (!ctx) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const padding = { left: 40, right: 20, top: 20, bottom: 30 }
  const innerWidth = cssWidth - padding.left - padding.right
  const innerHeight = cssHeight - padding.top - padding.bottom

  const xs = data.map(d => d.index)
  const ys = data.map(d => d.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const xScale = (val) => {
    if (maxX === minX) return padding.left + innerWidth / 2
    return padding.left + ((val - minX) / (maxX - minX)) * innerWidth
  }
  const yScale = (val) => {
    if (maxY === minY) return padding.top + innerHeight / 2
    return padding.top + (1 - (val - minY) / (maxY - minY)) * innerHeight
  }

  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, cssHeight - padding.bottom)
  ctx.lineTo(cssWidth - padding.right, cssHeight - padding.bottom)
  ctx.stroke()

  ctx.strokeStyle = '#007bff'
  ctx.lineWidth = 2
  ctx.beginPath()
  data.forEach((point, idx) => {
    const x = xScale(point.index)
    const y = yScale(point.y)
    if (idx === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()

  ctx.fillStyle = '#ff6600'
  data.forEach(point => {
    const x = xScale(point.index)
    const y = yScale(point.y)
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  data.forEach(point => {
    const x = xScale(point.index)
    const y = yScale(point.y)
    ctx.fillText(point.y.toFixed(2), x, y - 6)
  })
}

watch(
  () => props.waferList,
  () => {
    fetchSeries()
  },
  { deep: true }
)

onMounted(() => {
  fetchSeries()
})

onBeforeUnmount(() => {
  canvasMap.value.clear()
})
</script>

<style scoped>
.defect-chart-panel {
  margin: 20px auto;
  width: 80%;
  padding: 16px;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  background: #fafafa;
}

.chart-hint {
  margin-top: 4px;
  color: #666;
  font-size: 13px;
}

.chart-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 12px;
}

.chart-item {
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  background: #fff;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  color: #333;
}

.chart-count {
  color: #666;
}

.defect-chart-canvas {
  width: 100%;
  height: 240px;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  background: #fff;
}

.empty-placeholder {
  margin-top: 12px;
  color: #888;
}
</style>
