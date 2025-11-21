<template>
  <div class="defect-chart-panel">
    <h3>Wafer 缺陷折线图</h3>
    <p class="chart-hint">
      按 waferKey 展示：竖/横切割道的 bias 散点与平均折线，以及 bias 极差折线。
    </p>

    <div class="chart-list" v-if="chartSeries.length">
      <div
        class="chart-item"
        v-for="series in chartSeries"
        :key="series.waferKey"
      >
        <div class="chart-header">
          <span class="chart-title">WaferKey: {{ series.waferKey }}</span>
          <span class="chart-count">有效点: {{ series.validCount }}</span>
        </div>

        <div class="chart-grid">
          <div class="chart-block">
            <div class="chart-block-title">竖切割道 bias 散点 + 平均线</div>
            <canvas
              :ref="el => setCanvasRef(el, series.waferKey, 'verticalScatter')"
              class="defect-chart-canvas"
            ></canvas>
          </div>
          <div class="chart-block">
            <div class="chart-block-title">横切割道 bias 散点 + 平均线</div>
            <canvas
              :ref="el => setCanvasRef(el, series.waferKey, 'horizontalScatter')"
              class="defect-chart-canvas"
            ></canvas>
          </div>
          <div class="chart-block">
            <div class="chart-block-title">竖切割道 bias 极差折线</div>
            <canvas
              :ref="el => setCanvasRef(el, series.waferKey, 'verticalRange')"
              class="defect-chart-canvas"
            ></canvas>
          </div>
          <div class="chart-block">
            <div class="chart-block-title">横切割道 bias 极差折线</div>
            <canvas
              :ref="el => setCanvasRef(el, series.waferKey, 'horizontalRange')"
              class="defect-chart-canvas"
            ></canvas>
          </div>
        </div>
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

const setCanvasRef = (el, waferKey, type) => {
  if (!waferKey || !type) return
  const key = `${waferKey}-${type}`
  if (el) {
    canvasMap.value.set(key, el)
  } else {
    canvasMap.value.delete(key)
  }
}

const normalizeDefects = (rawList = []) => {
  return rawList
    .map(item => {
      const x = Number(item.waferX)
      const y = Number(item.waferY)
      const bias = Number(item.bias)
      if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(bias)) return null
      const indexX = Number(item.indexX)
      const indexY = Number(item.indexY)
      return { x, y, bias, indexX, indexY }
    })
    .filter(Boolean)
}

const splitByScribe = (defects, wafer) => {
  const dieWidth = Number(wafer.sizeX)
  const dieHeight = Number(wafer.sizeY)
  const offsetX = Number(wafer.centerX) || 0
  const offsetY = Number(wafer.centerY) || 0

  if (!dieWidth || !dieHeight) return {
    verticalScatter: [],
    horizontalScatter: [],
    verticalRange: [],
    horizontalRange: []
  }

  const verticalMap = new Map()
  const horizontalMap = new Map()

  defects.forEach(defect => {
    const col = Math.floor((defect.x - offsetX) / dieWidth)
    const row = Math.floor((defect.y - offsetY) / dieHeight)

    const localX = defect.x - (offsetX + col * dieWidth)
    const localY = defect.y - (offsetY + row * dieHeight)
    const slopeY = (dieHeight / dieWidth) * localX

    if (localY >= slopeY) {
      const columnValues = verticalMap.get(col) || []
      columnValues.push(defect.bias)
      verticalMap.set(col, columnValues)
    } else {
      const rowValues = horizontalMap.get(row) || []
      rowValues.push(defect.bias)
      horizontalMap.set(row, rowValues)
    }
  })

  const buildScatter = (map) => {
    return Array.from(map.entries()).flatMap(([index, values]) =>
      values.map(v => ({ index, value: v }))
    )
  }

  const buildAverage = (map) => {
    return Array.from(map.entries())
      .map(([index, values]) => {
        const sum = values.reduce((acc, cur) => acc + cur, 0)
        return { index, value: sum / values.length }
      })
      .sort((a, b) => a.index - b.index)
  }

  const buildRange = (map) => {
    return Array.from(map.entries())
      .map(([index, values]) => {
        const min = Math.min(...values)
        const max = Math.max(...values)
        return { index, value: max - min }
      })
      .sort((a, b) => a.index - b.index)
  }

  return {
    verticalScatter: buildScatter(verticalMap),
    horizontalScatter: buildScatter(horizontalMap),
    verticalAverage: buildAverage(verticalMap),
    horizontalAverage: buildAverage(horizontalMap),
    verticalRange: buildRange(verticalMap),
    horizontalRange: buildRange(horizontalMap)
  }
}

const fetchSeries = async () => {
  if (!props.waferList || props.waferList.length === 0) {
    chartSeries.value = []
    return
  }

  const tasks = props.waferList.map(async wafer => {
    const waferKey = wafer.waferKey || wafer.wafer_key
    if (!waferKey) return null
    try {
      const rawData = await fetchDefectRawData(waferKey)
      const normalized = normalizeDefects(rawData)
      const chartData = splitByScribe(normalized, wafer)
      return {
        waferKey,
        validCount: normalized.length,
        ...chartData
      }
    } catch (err) {
      console.error(`获取 wafer ${waferKey} 缺陷数据失败:`, err)
      return null
    }
  })

  const result = (await Promise.all(tasks)).filter(Boolean)
  chartSeries.value = result.filter(item => item.validCount > 0)
  drawAllCharts()
}

const drawAllCharts = () => {
  chartSeries.value.forEach(series => {
    const verticalScatterCvs = canvasMap.value.get(`${series.waferKey}-verticalScatter`)
    const horizontalScatterCvs = canvasMap.value.get(`${series.waferKey}-horizontalScatter`)
    const verticalRangeCvs = canvasMap.value.get(`${series.waferKey}-verticalRange`)
    const horizontalRangeCvs = canvasMap.value.get(`${series.waferKey}-horizontalRange`)

    if (verticalScatterCvs) drawScatterWithAverage(verticalScatterCvs, series.verticalScatter, series.verticalAverage)
    if (horizontalScatterCvs) drawScatterWithAverage(horizontalScatterCvs, series.horizontalScatter, series.horizontalAverage)
    if (verticalRangeCvs) drawRangeChart(verticalRangeCvs, series.verticalRange)
    if (horizontalRangeCvs) drawRangeChart(horizontalRangeCvs, series.horizontalRange)
  })
}

const drawScatterWithAverage = (cvs, scatterPoints, averagePoints) => {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = cvs.clientWidth || 500
  const cssHeight = cvs.clientHeight || 240
  cvs.width = cssWidth * dpr
  cvs.height = cssHeight * dpr

  const ctx = cvs.getContext('2d')
  if (!ctx) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const padding = { left: 50, right: 20, top: 20, bottom: 40 }
  const innerWidth = cssWidth - padding.left - padding.right
  const innerHeight = cssHeight - padding.top - padding.bottom

  const allPoints = [...scatterPoints, ...averagePoints]
  if (allPoints.length === 0) return

  const xs = allPoints.map(p => p.index)
  const ys = allPoints.map(p => p.value)
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

  ctx.strokeStyle = '#444'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, cssHeight - padding.bottom)
  ctx.lineTo(cssWidth - padding.right, cssHeight - padding.bottom)
  ctx.stroke()

  ctx.setLineDash([4, 4])
  ctx.beginPath()
  const zeroY = yScale(0)
  ctx.moveTo(padding.left, zeroY)
  ctx.lineTo(cssWidth - padding.right, zeroY)
  ctx.strokeStyle = '#ccc'
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = '#007bff'
  scatterPoints.forEach(point => {
    const x = xScale(point.index)
    const y = yScale(point.value)
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  })

  if (averagePoints.length > 0) {
    ctx.strokeStyle = '#ff7f0e'
    ctx.lineWidth = 2
    ctx.beginPath()
    averagePoints.forEach((point, idx) => {
      const x = xScale(point.index)
      const y = yScale(point.value)
      if (idx === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const uniqueIndices = Array.from(new Set(xs)).sort((a, b) => a - b)
  uniqueIndices.forEach(idx => {
    const x = xScale(idx)
    ctx.fillText(String(idx), x, cssHeight - padding.bottom + 6)
  })
}

const drawRangeChart = (cvs, rangePoints) => {
  const dpr = window.devicePixelRatio || 1
  const cssWidth = cvs.clientWidth || 500
  const cssHeight = cvs.clientHeight || 240
  cvs.width = cssWidth * dpr
  cvs.height = cssHeight * dpr

  const ctx = cvs.getContext('2d')
  if (!ctx) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const padding = { left: 50, right: 20, top: 20, bottom: 40 }
  const innerWidth = cssWidth - padding.left - padding.right
  const innerHeight = cssHeight - padding.top - padding.bottom

  if (rangePoints.length === 0) return

  const xs = rangePoints.map(p => p.index)
  const ys = rangePoints.map(p => p.value)
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

  ctx.strokeStyle = '#444'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, cssHeight - padding.bottom)
  ctx.lineTo(cssWidth - padding.right, cssHeight - padding.bottom)
  ctx.stroke()

  ctx.strokeStyle = '#2ca02c'
  ctx.lineWidth = 2
  ctx.beginPath()
  rangePoints.forEach((point, idx) => {
    const x = xScale(point.index)
    const y = yScale(point.value)
    if (idx === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  ctx.fillStyle = '#2ca02c'
  rangePoints.forEach(point => {
    const x = xScale(point.index)
    const y = yScale(point.value)
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.fillStyle = '#333'
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const uniqueIndices = Array.from(new Set(xs)).sort((a, b) => a - b)
  uniqueIndices.forEach(idx => {
    const x = xScale(idx)
    ctx.fillText(String(idx), x, cssHeight - padding.bottom + 6)
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
  width: 90%;
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
  margin-bottom: 12px;
  font-size: 14px;
  color: #333;
}

.chart-count {
  color: #666;
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.chart-block-title {
  font-size: 13px;
  color: #444;
  margin-bottom: 6px;
}

.defect-chart-canvas {
  width: 100%;
  height: 220px;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  background: #fff;
}

.empty-placeholder {
  margin-top: 12px;
  color: #888;
}
</style>
