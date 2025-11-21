<!-- WaferCanvas.vue - 优化版本 -->
<template>
  <div class="wafer-container">
    <!-- 左侧：画布区域 -->
    <div class="canvas-wrapper">
      <canvas ref="canvas" :style="{
        width: viewSize + 'px',
        height: viewSize + 'px',
        border: '1px solid #ccc'
      }"></canvas>
    </div>

    <!-- 右侧：选中量测点信息展示区域 -->
    <div class="selected-info">
      <h3>选中的量测点信息</h3>
      <div class="info-content">
        <!-- defect 区域：高度和左侧 wafer 一致 -->
        <div class="defect-panel" style="height: 500px;">
          <div class="summary">
            <p>已选中: <span class="count">{{ selectedDefects.length }}</span> 个量测点</p>
            <p v-if="selectedDefects.length > 0">
              分布:
              <span v-if="isSameRow">同一行 (行号范围: {{ minRow + 1 }} - {{ maxRow + 1 }})</span>
              <span v-else-if="isSameColumn">同一列 (列号范围: {{ minCol + 1 }} - {{ maxCol + 1 }})</span>
              <span v-else>多行多列</span>
            </p>
          </div>

          <!-- 缺陷列表：横向排列 + 水平滚动 -->
          <div class="defect-list-with-images" v-if="selectedDefects.length > 0">
            <div class="defect-item-with-image" v-for="defect in selectedDefects" :key="defect.defect_id">
              <!-- 上：图片画布 -->
              <div class="defect-image-container">
                <div class="image-wrapper" @click="showFullSizeImage(defect.defect_id)">
                  <canvas :ref="(el) => setImageCanvasRef(el, defect.defect_id)" width="220" height="220"
                    class="defect-image-canvas"></canvas>
                  <div class="image-overlay">
                    <span class="magnify-icon">🔍</span>
                    <span class="click-hint">点击查看大图</span>
                  </div>
                </div>
              </div>

              <!-- 下：信息和详情 -->
              <div class="defect-info">
                <div class="defect-header">
                  <span class="defect-id">ID: {{ defect.defect_id }}</span>
                  <button class="remove-btn" @click="removeDefect(defect)">×</button>
                </div>

                <!-- 显示从API获取的详情 -->
                <div v-if="defectDetailsMap.has(defect.defect_id)" class="defect-details">
                  <p><strong>Bias:</strong> {{ defectDetailsMap.get(defect.defect_id).bias }}</p>
                  <p><strong>Index_x:</strong> {{ getDefectIndex(defect.defect_id)?.index_x }}</p>
                  <p><strong>Index_y:</strong> {{ getDefectIndex(defect.defect_id)?.index_y }}</p>
                </div>
                <div v-else class="defect-details">
                  <p>无量测数据...</p>
                  <p><strong>Index_x:</strong> {{ getDefectIndex(defect.defect_id)?.index_x }}</p>
                  <p><strong>Index_y:</strong> {{ getDefectIndex(defect.defect_id)?.index_y }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="empty-state" v-else>
            <p>暂未选中任何量测点</p>
            <p class="hint">点击画布上的量测点进行选择</p>
          </div>

          <div class="actions" v-if="selectedDefects.length > 0">
            <button class="clear-btn" @click="clearAllDefects">清空选择</button>
          </div>
        </div>

        <!-- Bias 折线图 -->
        <div class="bias-chart-container">
          <h4>Bias 折线图</h4>
          <canvas ref="biasChartCanvas" class="bias-chart-canvas"></canvas>
        </div>
      </div>
    </div>

    <!-- 全尺寸图片模态框 -->
    <div v-if="showModal" class="modal-overlay" @click="closeModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>量测点图片 - ID: {{ currentModalDefectId }}</h3>
          <button class="modal-close-btn" @click="closeModal">×</button>
        </div>
        <div class="modal-body">
          <canvas ref="fullSizeCanvas" class="full-size-canvas"></canvas>
          <div v-if="currentModalDefectId && defectDetailsMap.has(currentModalDefectId)" class="modal-details">
            <p><strong>Bias:</strong> {{ defectDetailsMap.get(currentModalDefectId).bias }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { fetchDefectDetail, fetchDefectImage } from '@/apis/aoi.js'

// Props
const props = defineProps({
  radius: { type: Number, required: true },
  dieWidth: { type: Number, required: true },
  dieHeight: { type: Number, required: true },
  offsetX: { type: Number, default: 0 },
  offsetY: { type: Number, default: 0 },
  viewSize: { type: Number, default: 600 },
  defectPoints: { type: Array, default: () => [] },
  waferInfo: { type: Object, default: () => ({}) },
  waferKey: { type: Number, required: true }
})

// =================== 常量配置 ===================
const CONFIG = {
  CANVAS: {
    DEFAULT_SIZE: 600,
    MAX_MODAL_WIDTH: 2240,
    MAX_MODAL_HEIGHT: 2240,
    IMAGE_SIZE: 220,
    POINT_SIZE: 3,
    SELECTED_POINT_SIZE: 4,
    FLASH_COUNT: 3,
    FLASH_INTERVAL: 150
  },
  UI: {
    CLICK_THRESHOLD: 5,
    DASH_PATTERN: [4, 4],
    MODAL_Z_INDEX: 1000
  },
  COLORS: {
    WAFER_BORDER: '#666',
    GRID_STROKE: '#0080ff',
    GRID_FILL: 'rgba(0, 128, 255, 0.1)',
    DEFECT_DEFAULT: '#ff0000',
    DEFECT_SELECTED: '#ff9900',
    DEFECT_SELECTED_STROKE: '#ff6600',
    SELECTION_RECT: '#0000ff',
    CHART_LINE: '#007bff',
    CHART_POINT_RED: '#ff0000',    // 相同index点的红色
    TEXT_COLOR: '#333',
    SUCCESS: '#00ff00'
  }
}

// =================== 响应式状态 ===================
// Refs for data and DOM elements
const defectDetailsMap = ref(new Map())
const defectImageBlobsMap = ref(new Map())
const imageCanvasRefs = ref({})
const biasChartCanvas = ref(null)
const selectedDefects = ref([])
const canvas = ref(null)
const fullSizeCanvas = ref(null)

// Modal states
const showModal = ref(false)
const currentModalDefectId = ref(null)

// 绘制状态
const currentDefects = ref([])
let drawingAnimationFrame = null

// Drag selection states
const dragging = ref(false)
const startX = ref(0)
const startY = ref(0)
const endX = ref(0)
const endY = ref(0)

// =================== 计算属性 ===================
// 优化的计算属性
const isSameRow = computed(() => {
  if (selectedDefects.value.length === 0) return false
  const { dieHeight, offsetY } = props
  const firstRow = Math.floor((selectedDefects.value[0].y - offsetY) / dieHeight)
  return selectedDefects.value.every(d => 
    Math.floor((d.y - offsetY) / dieHeight) === firstRow
  )
})

const isSameColumn = computed(() => {
  if (selectedDefects.value.length === 0) return false
  const { dieWidth, offsetX } = props
  const firstCol = Math.floor((selectedDefects.value[0].x - offsetX) / dieWidth)
  return selectedDefects.value.every(d => 
    Math.floor((d.x - offsetX) / dieWidth) === firstCol
  )
})

const minRow = computed(() => {
  if (selectedDefects.value.length === 0) return 0
  const { dieHeight, offsetY } = props
  return Math.min(...selectedDefects.value.map(d => 
    Math.floor((d.y - offsetY) / dieHeight)
  ))
})

const maxRow = computed(() => {
  if (selectedDefects.value.length === 0) return 0
  const { dieHeight, offsetY } = props
  return Math.max(...selectedDefects.value.map(d => 
    Math.floor((d.y - offsetY) / dieHeight)
  ))
})

const minCol = computed(() => {
  if (selectedDefects.value.length === 0) return 0
  const { dieWidth, offsetX } = props
  return Math.min(...selectedDefects.value.map(d => 
    Math.floor((d.x - offsetX) / dieWidth)
  ))
})

const maxCol = computed(() => {
  if (selectedDefects.value.length === 0) return 0
  const { dieWidth, offsetX } = props
  return Math.max(...selectedDefects.value.map(d => 
    Math.floor((d.x - offsetX) / dieWidth)
  ))
})

// 缓存的bias数据 - 包含相同index点的标识
const biasChartData = computed(() => {
  // 收集所有有效数据
  const validData = selectedDefects.value
    .map(defect => {
      const detail = defectDetailsMap.value.get(defect.defect_id)
      if (!detail || detail.bias === undefined || detail.bias === null) return null
      const bias = parseFloat(detail.bias)
      if (Number.isNaN(bias)) return null
      
      const defectIndex = getDefectIndex(defect.defect_id)
      if (!defectIndex) return null
      
      return {
        id: defect.defect_id,
        bias,
        index_x: defectIndex.index_x,
        index_y: defectIndex.index_y
      }
    })
    .filter(Boolean)

  if (validData.length === 0) return []

  // 按index_x和index_y分组，对于相同坐标的只保留defect_id最小的
  const coordinateMap = new Map()
  const duplicateCoordinates = new Set() // 记录有重复的坐标
  
  validData.forEach(item => {
    const key = `${item.index_x},${item.index_y}`
    
    if (!coordinateMap.has(key)) {
      coordinateMap.set(key, item)
    } else {
      const existing = coordinateMap.get(key)
      if (item.id < existing.id) {
        coordinateMap.set(key, item) // 保留defect_id更小的
      }
      // 标记这个坐标有重复（不管保留的是哪一个）
      duplicateCoordinates.add(key)
    }
  })

  // 转换为数组并按defect_id升序排序，同时标识是否为重复点
  return Array.from(coordinateMap.values())
    .sort((a, b) => a.id - b.id)
    .map(item => {
      const key = `${item.index_x},${item.index_y}`
      return {
        id: item.id,
        bias: item.bias,
        isDuplicate: duplicateCoordinates.has(key) // 标识是否为重复坐标的点
      }
    })
})

// =================== 工具函数 ===================
const setImageCanvasRef = (el, defect_id) => {
  if (el) {
    imageCanvasRefs.value[defect_id] = el
  } else {
    delete imageCanvasRefs.value[defect_id]
  }
}

const getDefectIndex = (defectId) => {
  const defect = props.defectPoints.find(d => d.defect_id === defectId)
  if (defect) {
    return {
      index_x: defect.index_x,
      index_y: defect.index_y
    }
  }
  return null
}

// 优化的坐标转换
const getWorldToCanvasTransform = () => {
  const { viewSize, radius } = props
  const cx = viewSize / 2
  const cy = viewSize / 2
  const maxRadiusPx = viewSize * 0.45
  const scale = maxRadiusPx / radius
  
  return {
    worldToCanvas: (wx, wy) => ({
      x: cx + wx * scale,
      y: cy - wy * scale
    }),
    scale,
    centerX: cx,
    centerY: cy
  }
}

// =================== 图片绘制优化 ===================
const createImageFromBlob = (blob) => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

// 统一图片绘制函数
const drawImageWithOverlay = (ctx, img, canvasWidth, canvasHeight, defectId, isFullSize = false) => {
  const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height)
  const x = canvasWidth / 2 - (img.width / 2) * scale
  const y = canvasHeight / 2 - (img.height / 2) * scale
  
  // 绘制图片
  ctx.drawImage(img, x, y, img.width * scale, img.height * scale)
  
  // 绘制覆盖层
  drawSelectedPointsLines(ctx, defectId, scale, x, y, isFullSize)
}

// 优化的线条绘制
const drawSelectedPointsLines = (ctx, defectId, scale, offsetX, offsetY, isFullSize = false) => {
  const defectDetails = defectDetailsMap.value.get(defectId)
  if (!defectDetails?.selectedPoints) return

  try {
    const points = JSON.parse(defectDetails.selectedPoints)
    if (!Array.isArray(points) || points.length < 4) return

    // 设置样式
    ctx.strokeStyle = CONFIG.COLORS.SELECTION_RECT
    ctx.lineWidth = isFullSize ? 2 : 2
    ctx.lineCap = 'round'
    ctx.font = `${isFullSize ? 16 : 12}px Arial`
    ctx.fillStyle = CONFIG.COLORS.SUCCESS

    // 绘制两条线
    const drawLine = (p1, p2, text) => {
      ctx.beginPath()
      ctx.moveTo(p1[0] * scale + offsetX, p1[1] * scale + offsetY)
      ctx.lineTo(p2[0] * scale + offsetX, p2[1] * scale + offsetY)
      ctx.stroke()

      // 绘制文本
      const midX = ((p1[0] + p2[0]) / 2) * scale + offsetX
      const midY = ((p1[1] + p2[1]) / 2) * scale + offsetY
      ctx.fillText(text, midX, midY)
    }

    drawLine(points[0], points[1], defectDetails.dist1)
    drawLine(points[2], points[3], defectDetails.dist2)
  } catch (error) {
    console.error(`Error parsing selectedPoints for defect ${defectId}:`, error)
  }
}

// =================== 画布绘制 ===================
const drawImageOnCanvas = async (canvas, blob, defectId) => {
  if (!canvas || !blob) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  try {
    const img = await createImageFromBlob(blob)
    const { width, height } = canvas
    
    // 清除画布
    ctx.clearRect(0, 0, width, height)
    
    // 绘制图片
    drawImageWithOverlay(ctx, img, width, height, defectId, false)
  } catch (error) {
    console.error(`Failed to load image for defect_id ${defectId}:`, error)
  }
}

const drawBiasChart = () => {
  const cvs = biasChartCanvas.value
  if (!cvs) return

  const dpr = window.devicePixelRatio || 1
  const cssWidth = cvs.clientWidth || 400
  const cssHeight = cvs.clientHeight || 200

  cvs.width = cssWidth * dpr
  cvs.height = cssHeight * dpr

  const ctx = cvs.getContext('2d')
  if (!ctx) return

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  // 图表边距和尺寸
  const padding = { left: 40, right: 20, top: 20, bottom: 30 }
  const innerWidth = cssWidth - padding.left - padding.right
  const innerHeight = cssHeight - padding.top - padding.bottom

  const yForBias = (b) => {
    const clamped = Math.max(-1, Math.min(1, b))
    const ratio = (1 - clamped) / 2
    return padding.top + ratio * innerHeight
  }

  // 绘制坐标轴
  ctx.strokeStyle = CONFIG.COLORS.TEXT_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(padding.left, padding.top)
  ctx.lineTo(padding.left, cssHeight - padding.bottom)
  const axisY = yForBias(-1)
  ctx.moveTo(padding.left, axisY)
  ctx.lineTo(cssWidth - padding.right, axisY)
  ctx.stroke()

  // Y轴刻度
  ctx.fillStyle = CONFIG.COLORS.TEXT_COLOR
  ctx.font = '12px Arial'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ;[-1, 0, 1].forEach(b => {
    const y = yForBias(b)
    ctx.beginPath()
    ctx.moveTo(padding.left - 4, y)
    ctx.lineTo(padding.left, y)
    ctx.stroke()
    ctx.fillText(b.toString(), padding.left - 6, y)
  })

  const data = biasChartData.value
  if (data.length === 0) return

  // 绘制折线和数据点
  const stepX = innerWidth / (data.length + 1)
  
  ctx.strokeStyle = CONFIG.COLORS.CHART_LINE
  ctx.lineWidth = 2
  ctx.beginPath()
  data.forEach((point, index) => {
    const x = padding.left + stepX * (index + 1)
    const y = yForBias(point.bias)
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()

  // 绘制数据点和标签
  data.forEach((point, index) => {
    const x = padding.left + stepX * (index + 1)
    const y = yForBias(point.bias)

    // 根据是否为重复点选择颜色
    const pointColor = point.isDuplicate ? CONFIG.COLORS.CHART_POINT_RED : CONFIG.COLORS.CHART_LINE
    
    ctx.fillStyle = pointColor
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = CONFIG.COLORS.TEXT_COLOR
    ctx.font = '12px Arial'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(point.bias.toFixed(3), x, y - 4)
  })

  // X轴标签
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  data.forEach((point, index) => {
    const x = padding.left + stepX * (index + 1)
    const labelY = cssHeight - padding.bottom + 4
    ctx.fillText(String(point.id), x, labelY)
  })
}

const drawWaferInfo = (ctx) => {
  const { waferInfo } = props
  const padding = 8
  const lineHeight = 14
  const fontSize = 12

  ctx.save()
  ctx.font = `${fontSize}px Arial`
  ctx.fillStyle = CONFIG.COLORS.TEXT_COLOR
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  const infoLines = [
    `Measure Time: ${waferInfo.scanTime || ''}`,
    `Product: ${waferInfo.product || ''}`,
    `Layer: ${waferInfo.layerId || ''}`,
    `Eqp: ${waferInfo.inspectionEqp || ''}`,
    `Lot: ${waferInfo.lotId || ''}`,
    `Wafer: ${waferInfo.waferId || ''}`,
    `Defects: ${waferInfo.defectCount || 0}`
  ]

  infoLines.forEach((line, index) => {
    ctx.fillText(line, padding, padding + index * lineHeight)
  })

  ctx.restore()
}

const drawWafer = () => {
  const cvs = canvas.value
  if (!cvs) return

  const { radius, dieWidth: w, dieHeight: h, offsetX, offsetY, viewSize, defectPoints } = props

  if (radius <= 0 || w <= 0 || h <= 0) return

  // 取消之前的绘制请求
  if (drawingAnimationFrame) {
    cancelAnimationFrame(drawingAnimationFrame)
  }

  drawingAnimationFrame = requestAnimationFrame(() => {
    const dpr = window.devicePixelRatio || 1
    cvs.width = viewSize * dpr
    cvs.height = viewSize * dpr

    const ctx = cvs.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, viewSize, viewSize)

    drawWaferInfo(ctx)

    const transform = getWorldToCanvasTransform()
    const { worldToCanvas, scale } = transform

    // 绘制晶圆边界
    ctx.save()
    ctx.beginPath()
    const cx = viewSize / 2
    const cy = viewSize / 2
    ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2)
    ctx.strokeStyle = CONFIG.COLORS.WAFER_BORDER
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    // 绘制晶粒网格
    const r2 = radius * radius
    const minI = Math.ceil((-radius - offsetX) / w)
    const maxI = Math.floor((radius - w - offsetX) / w)
    const minJ = Math.ceil((-radius - offsetY) / h)
    const maxJ = Math.floor((radius - h - offsetY) / h)

    ctx.save()
    ctx.lineWidth = 0.5
    ctx.strokeStyle = CONFIG.COLORS.GRID_STROKE
    ctx.fillStyle = CONFIG.COLORS.GRID_FILL

    for (let i = minI; i <= maxI; i++) {
      const blX = offsetX + i * w
      for (let j = minJ; j <= maxJ; j++) {
        const blY = offsetY + j * h
        const corners = [
          { x: blX, y: blY },
          { x: blX + w, y: blY },
          { x: blX + w, y: blY + h },
          { x: blX, y: blY + h }
        ]
        
        if (corners.every(corner => corner.x * corner.x + corner.y * corner.y <= r2)) {
          const topLeftCanvas = worldToCanvas(blX, blY + h)
          ctx.fillRect(topLeftCanvas.x, topLeftCanvas.y, w * scale, h * scale)
          ctx.strokeRect(topLeftCanvas.x, topLeftCanvas.y, w * scale, h * scale)
        }
      }
    }
    ctx.restore()

    // 绘制缺陷点
    currentDefects.value = []
    ctx.save()
    const pointSize = CONFIG.CANVAS.POINT_SIZE
    const selectedPointSize = CONFIG.CANVAS.SELECTED_POINT_SIZE
    const clickRadius = Math.max(5, 10 / scale)
    
    for (const point of defectPoints) {
      if (point.x * point.x + point.y * point.y > r2) continue
      
      currentDefects.value.push({
        defect_id: point.defect_id,
        x: point.x,
        y: point.y,
        clickRadius
      })
      
      const canvasPoint = worldToCanvas(point.x, point.y)
      const isSelected = selectedDefects.value.some(d => d.defect_id === point.defect_id)
      
      if (isSelected) {
        ctx.fillStyle = CONFIG.COLORS.DEFECT_SELECTED
        const size = selectedPointSize * dpr
        ctx.fillRect(canvasPoint.x - size / 2, canvasPoint.y - size / 2, size, size)
        ctx.strokeStyle = CONFIG.COLORS.DEFECT_SELECTED_STROKE
        ctx.lineWidth = 1.5
        ctx.strokeRect(canvasPoint.x - size / 2 - 2, canvasPoint.y - size / 2 - 2, size + 4, size + 4)
      } else {
        ctx.fillStyle = CONFIG.COLORS.DEFECT_DEFAULT
        const size = pointSize * dpr
        ctx.fillRect(canvasPoint.x - size / 2, canvasPoint.y - size / 2, size, size)
      }
    }
    ctx.restore()

    // 绘制选择框
    if (dragging.value) {
      ctx.save()
      ctx.strokeStyle = CONFIG.COLORS.SELECTION_RECT
      ctx.lineWidth = 1
      ctx.setLineDash(CONFIG.UI.DASH_PATTERN)
      const rectX = Math.min(startX.value, endX.value)
      const rectY = Math.min(startY.value, endY.value)
      const rectWidth = Math.abs(endX.value - startX.value)
      const rectHeight = Math.abs(endY.value - startY.value)
      ctx.strokeRect(rectX, rectY, rectWidth, rectHeight)
      ctx.restore()
    }
  })
}

// =================== 事件处理 ===================
const handleKeyDown = (event) => {
  if (event.key === 'Escape' && showModal.value) {
    closeModal()
  }
}

const handleMouseDown = (event) => {
  const rect = canvas.value.getBoundingClientRect()
  startX.value = event.clientX - rect.left
  startY.value = event.clientY - rect.top
  endX.value = startX.value
  endY.value = startY.value
  dragging.value = true
}

const handleMouseMove = (event) => {
  if (!dragging.value) return
  const rect = canvas.value.getBoundingClientRect()
  endX.value = event.clientX - rect.left
  endY.value = event.clientY - rect.top
  drawWafer()
}

const handleMouseUp = (event) => {
  if (!dragging.value) return
  dragging.value = false

  // 检查是否为点击
  const deltaX = Math.abs(endX.value - startX.value)
  const deltaY = Math.abs(endY.value - startY.value)
  if (deltaX < CONFIG.UI.CLICK_THRESHOLD && deltaY < CONFIG.UI.CLICK_THRESHOLD) {
    handleCanvasClick(event)
    return
  }

  // 处理拖拽选择
  const transform = getWorldToCanvasTransform()
  const minCanvasX = Math.min(startX.value, endX.value)
  const maxCanvasX = Math.max(startX.value, endX.value)
  const minCanvasY = Math.min(startY.value, endY.value)
  const maxCanvasY = Math.max(startY.value, endY.value)

  const candidates = currentDefects.value.filter(defect => {
    const isAlreadySelected = selectedDefects.value.some(d => d.defect_id === defect.defect_id)
    if (isAlreadySelected) return false
    const canvasPoint = {
      x: transform.centerX + defect.x * transform.scale,
      y: transform.centerY - defect.y * transform.scale
    }
    return (
      canvasPoint.x >= minCanvasX &&
      canvasPoint.x <= maxCanvasX &&
      canvasPoint.y >= minCanvasY &&
      canvasPoint.y <= maxCanvasY
    )
  })

  if (candidates.length === 0) {
    drawWafer()
    return
  }

  const tempSelected = [...selectedDefects.value, ...candidates.map(d => ({
    defect_id: d.defect_id, x: d.x, y: d.y
  }))]

  if (checkSameRowOrColumn(tempSelected)) {
    selectedDefects.value = tempSelected
  } else {
    console.warn('选中的量测点必须在同一行或同一列！')
  }

  drawWafer()
}

const handleCanvasClick = (event) => {
  const cvs = canvas.value
  if (!cvs) return
  
  const rect = cvs.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const transform = getWorldToCanvasTransform()
  const wx = (x - transform.centerX) / transform.scale
  const wy = (transform.centerY - y) / transform.scale
  
  for (const defect of currentDefects.value) {
    const distance = Math.sqrt(Math.pow(wx - defect.x, 2) + Math.pow(wy - defect.y, 2))
    if (distance <= defect.clickRadius) {
      const index = selectedDefects.value.findIndex(d => d.defect_id === defect.defect_id)
      if (index > -1) {
        selectedDefects.value.splice(index, 1)
      } else {
        const tempSelected = [...selectedDefects.value, {
          defect_id: defect.defect_id, x: defect.x, y: defect.y
        }]
        if (checkSameRowOrColumn(tempSelected)) {
          selectedDefects.value.push({ defect_id: defect.defect_id, x: defect.x, y: defect.y })
        } else {
          console.warn('选中的量测点必须在同一行或同一列！')
          flashDefect(defect)
        }
      }
      drawWafer()
    }
  }
}

const flashDefect = (defect) => {
  const cvs = canvas.value
  if (!cvs) return
  
  const transform = getWorldToCanvasTransform()
  const ctx = cvs.getContext('2d')
  if (!ctx) return
  
  const canvasPoint = transform.worldToCanvas(defect.x, defect.y)
  const dpr = window.devicePixelRatio || 1
  const flashSize = 4 * dpr
  let flashCount = 0
  
  const flash = () => {
    if (flashCount >= CONFIG.CANVAS.FLASH_COUNT) {
      drawWafer()
      return
    }
    
    ctx.save()
    ctx.fillStyle = flashCount % 2 === 0 ? CONFIG.COLORS.DEFECT_DEFAULT : '#ffffff'
    ctx.fillRect(canvasPoint.x - flashSize / 2, canvasPoint.y - flashSize / 2, flashSize, flashSize)
    ctx.restore()
    
    flashCount++
    setTimeout(flash, CONFIG.CANVAS.FLASH_INTERVAL)
  }
  
  flash()
}

const checkSameRowOrColumn = (defects) => {
  if (defects.length === 0) return true
  const { dieWidth, dieHeight, offsetX, offsetY } = props
  const firstDefect = defects[0]
  const firstRow = Math.floor((firstDefect.y - offsetY) / dieHeight)
  const firstCol = Math.floor((firstDefect.x - offsetX) / dieWidth)
  const sameRow = defects.every(d => Math.floor((d.y - offsetY) / dieHeight) === firstRow)
  const sameColumn = defects.every(d => Math.floor((d.x - offsetX) / dieWidth) === firstCol)
  return sameRow || sameColumn
}

// =================== 缺陷管理 ===================
const removeDefect = (defectToRemove) => {
  const index = selectedDefects.value.findIndex(d => d.defect_id === defectToRemove.defect_id)
  if (index > -1) selectedDefects.value.splice(index, 1)
}

const clearAllDefects = () => {
  selectedDefects.value = []
}

// =================== 模态框功能 ===================
const showFullSizeImage = (defectId) => {
  currentModalDefectId.value = defectId
  showModal.value = true
  nextTick(() => {
    drawFullSizeImage()
  })
}

const closeModal = () => {
  showModal.value = false
  currentModalDefectId.value = null
}

const drawFullSizeImage = async () => {
  const cvs = fullSizeCanvas.value
  if (!cvs || !currentModalDefectId.value) return

  const blob = defectImageBlobsMap.value.get(currentModalDefectId.value)
  if (!blob) {
    console.error('No image data available for defect:', currentModalDefectId.value)
    return
  }

  const ctx = cvs.getContext('2d')
  if (!ctx) return

  try {
    const img = await createImageFromBlob(blob)
    
    // 计算画布尺寸
    let canvasWidth = img.width
    let canvasHeight = img.height
    
    // 限制最大尺寸
    if (canvasWidth > CONFIG.CANVAS.MAX_MODAL_WIDTH || 
        canvasHeight > CONFIG.CANVAS.MAX_MODAL_HEIGHT) {
      const scale = Math.min(
        CONFIG.CANVAS.MAX_MODAL_WIDTH / canvasWidth,
        CONFIG.CANVAS.MAX_MODAL_HEIGHT / canvasHeight
      )
      canvasWidth = canvasWidth * scale
      canvasHeight = canvasHeight * scale
    }

    // 设置高DPI画布
    const dpr = window.devicePixelRatio || 1
    cvs.width = canvasWidth * dpr
    cvs.height = canvasHeight * dpr
    cvs.style.width = canvasWidth + 'px'
    cvs.style.height = canvasHeight + 'px'

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    // 绘制图片和覆盖层
    drawImageWithOverlay(ctx, img, canvasWidth, canvasHeight, currentModalDefectId.value, true)
  } catch (error) {
    console.error(`Failed to load image for defect_id ${currentModalDefectId.value}:`, error)
  }
}

// =================== 生命周期 ===================
onMounted(async () => {
  drawWafer()
  const cvs = canvas.value
  cvs.addEventListener('mousedown', handleMouseDown)
  cvs.addEventListener('mousemove', handleMouseMove)
  cvs.addEventListener('mouseup', handleMouseUp)
  document.addEventListener('keydown', handleKeyDown)
  await nextTick()
  drawBiasChart()
})

onUnmounted(() => {
  const cvs = canvas.value
  if (cvs) {
    cvs.removeEventListener('mousedown', handleMouseDown)
    cvs.removeEventListener('mousemove', handleMouseMove)
    cvs.removeEventListener('mouseup', handleMouseUp)
  }
  document.removeEventListener('keydown', handleKeyDown)
  if (drawingAnimationFrame) {
    cancelAnimationFrame(drawingAnimationFrame)
  }
})

// =================== 响应式监听 ===================
watch(selectedDefects, async (newSelectedDefects) => {
  defectDetailsMap.value.clear()
  defectImageBlobsMap.value.clear()

  drawWafer()
  if (newSelectedDefects.length === 0) {
    await nextTick()
    drawBiasChart()
    return
  }

  // 并行获取数据和图片
  const promises = newSelectedDefects.map(async (defect) => {
    try {
      const [detailRes, imageRes] = await Promise.allSettled([
        fetchDefectDetail(props.waferKey, defect.defect_id),
        fetchDefectImage(props.waferKey, defect.defect_id)
      ])

      if (detailRes.status === 'fulfilled' && detailRes.value) {
        defectDetailsMap.value.set(defect.defect_id, detailRes.value)
      }
      
      if (imageRes.status === 'fulfilled' && imageRes.value?.data) {
        defectImageBlobsMap.value.set(defect.defect_id, imageRes.value.data)
      }
    } catch (error) {
      console.error(`Failed to fetch data for ${defect.defect_id}:`, error)
    }
  })

  await Promise.allSettled(promises)
  await nextTick()

  // 绘制图片
  for (const defect of newSelectedDefects) {
    const blob = defectImageBlobsMap.value.get(defect.defect_id)
    const imgCanvas = imageCanvasRefs.value[defect.defect_id]
    if (blob && imgCanvas) {
      drawImageOnCanvas(imgCanvas, blob, defect.defect_id)
    }
  }

  drawBiasChart()
}, { deep: true })

// 监听props变化
watch(() => [
  props.radius,
  props.dieWidth,
  props.dieHeight,
  props.offsetX,
  props.offsetY,
  props.viewSize,
  props.defectPoints,
  props.waferInfo
], () => {
  drawWafer()
  nextTick().then(drawBiasChart)
}, { deep: true })

// 缓存的bias图数据变化时重绘
watch(biasChartData, () => {
  drawBiasChart()
})
</script>

<style scoped>
.wafer-container {
  display: flex;
  gap: 20px;
  padding: 20px;
  font-family: Arial, sans-serif;
}

.canvas-wrapper {
  flex-shrink: 0;
}

.selected-info {
  flex: 1;
  min-width: 300px;
  background-color: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 16px;
  max-height: 800px;
  overflow-y: auto;
}

.selected-info h3 {
  margin-top: 0;
  margin-bottom: 16px;
  color: #333;
  font-size: 18px;
  border-bottom: 2px solid #007bff;
  padding-bottom: 8px;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.defect-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary {
  background-color: white;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.summary p {
  margin: 4px 0;
  font-size: 14px;
}

.count {
  font-weight: bold;
  color: #007bff;
  font-size: 16px;
}

.defect-list-with-images {
  flex: 1;
  display: flex;
  flex-direction: row;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 4px;
}

.defect-item-with-image {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  padding: 8px;
  background-color: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  transition: box-shadow 0.2s, transform 0.2s;
  min-width: 260px;
}

.defect-item-with-image:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}

.defect-image-container {
  flex-shrink: 0;
}

.image-wrapper {
  position: relative;
  display: inline-block;
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}

.image-wrapper:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 123, 255, 0.2);
}

.defect-image-canvas {
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #f9f9f9;
  display: block;
}

.image-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 123, 255, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-wrapper:hover .image-overlay {
  opacity: 1;
}

.magnify-icon {
  font-size: 24px;
  color: white;
  margin-bottom: 4px;
}

.click-hint {
  color: white;
  font-size: 12px;
  font-weight: 500;
}

.defect-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.defect-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.defect-id {
  font-family: monospace;
  font-weight: bold;
  color: #333;
  font-size: 16px;
}

.defect-details {
  font-size: 12px;
  color: #555;
  background-color: #fdfdfd;
  padding: 8px;
  border-radius: 4px;
  border: 1px solid #eee;
}

.defect-details p {
  margin: 2px 0;
}

.loading-placeholder {
  font-size: 12px;
  color: #999;
  font-style: italic;
}

.remove-btn {
  background-color: #dc3545;
  color: white;
  border: none;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.remove-btn:hover {
  background-color: #c82333;
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: #999;
}

.empty-state p {
  margin: 4px 0;
}

.hint {
  font-size: 12px;
  color: #bbb;
}

.actions {
  text-align: center;
}

.clear-btn {
  background-color: #6c757d;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.clear-btn:hover {
  background-color: #5a6268;
}

.bias-chart-container {
  background-color: #ffffff;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  padding: 12px;
}

.bias-chart-container h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #333;
}

.bias-chart-canvas {
  width: 100%;
  height: 200px;
  display: block;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  max-width: 90vw;
  max-height: 90vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e0e0e0;
  background-color: #f8f9fa;
  border-radius: 8px 8px 0 0;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  color: #333;
  font-weight: 600;
}

.modal-close-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: #666;
  cursor: pointer;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s, color 0.2s;
}

.modal-close-btn:hover {
  background-color: #e9ecef;
  color: #333;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.full-size-canvas {
  border: 1px solid #ddd;
  border-radius: 4px;
  background-color: #f9f9f9;
  max-width: 100%;
  height: auto;
  display: block;
}

.modal-details {
  background-color: #f8f9fa;
  padding: 12px;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
  width: 100%;
  max-width: 400px;
}

.modal-details p {
  margin: 4px 0;
  font-size: 14px;
}

.modal-details strong {
  color: #007bff;
}
</style>