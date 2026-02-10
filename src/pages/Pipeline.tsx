import { useState } from 'react'
import { Plus, TrendingUp, DollarSign, Target, BarChart3, GripVertical } from 'lucide-react'
import { usePipeline, usePipelineStats, useUpdateDealStage } from '@/hooks/usePipeline'
import { type PipelineDeal } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const STAGE_CONFIG = [
  { value: 'lead', label: 'Lead', color: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  { value: 'qualified', label: 'Qualified', color: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  { value: 'proposal', label: 'Proposal', color: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  { value: 'negotiation', label: 'Negotiation', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  { value: 'won', label: 'Won', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  { value: 'lost', label: 'Lost', color: 'bg-red-500/10 text-red-400 border-red-500/30' },
]

const LOST_REASONS = [
  { value: 'price', label: 'Giá cả' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'delivery', label: 'Thời gian giao hàng' },
  { value: 'competitor', label: 'Đối thủ cạnh tranh' },
  { value: 'no_budget', label: 'Không ngân sách' },
  { value: 'other', label: 'Khác' },
]

interface DealCardProps {
  deal: PipelineDeal
  isDragging?: boolean
  onClick?: () => void
}

function DealCard({ deal, isDragging, onClick }: DealCardProps) {
  const formatCurrency = (amount: number | null) => {
    if (!amount) return '—'
    return new Intl.NumberFormat('vi-VN', { notation: 'compact', compactDisplay: 'short' }).format(amount) + ' ₫'
  }

  return (
    <div
      className={cn(
        'rounded-lg bg-slate-800 border border-slate-700/50 p-4 group',
        'hover:border-slate-600 hover:shadow-md transition-all',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-white mb-0.5">{deal.customerName || 'No customer'}</h3>
          <p className="text-xs text-slate-400">{deal.title}</p>
        </div>
        <GripVertical className="h-4 w-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
      </div>

      <div className="flex items-center gap-3 mt-3">
        {deal.dealValue && (
          <span className="badge bg-brand-500/10 text-brand-400 border-brand-500/30 text-xs px-2 py-0.5">
            {formatCurrency(deal.dealValue)}
          </span>
        )}
        {deal.probability !== null && deal.probability !== undefined && (
          <span className="text-xs text-slate-500">{deal.probability}%</span>
        )}
        {deal.expectedCloseDate && (
          <span className="text-xs text-slate-500 ml-auto">
            {format(new Date(deal.expectedCloseDate), 'dd/MM')}
          </span>
        )}
      </div>
    </div>
  )
}

function SortableDealCard({ deal }: { deal: PipelineDeal }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deal.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <DealCard deal={deal} isDragging={isDragging} />
    </div>
  )
}

export default function Pipeline() {
  const [activeId, setActiveId] = useState<number | null>(null)

  // Queries
  const { data: pipelineData, isLoading } = usePipeline({ limit: 1000 })
  const { data: statsData } = usePipelineStats()
  const updateStageMutation = useUpdateDealStage()

  const deals = pipelineData?.data || []
  const stats = statsData?.data || []
  const totalWeighted = statsData?.totalWeighted || 0

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  const getDealsByStage = (stage: string) => {
    return deals.filter((deal) => deal.stage === stage)
  }

  const getStageStats = (stage: string) => {
    return stats.find((s) => s.stage === stage) || { count: 0, totalValue: 0, weightedValue: 0 }
  }

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '0'
    return new Intl.NumberFormat('vi-VN', { notation: 'compact', compactDisplay: 'short' }).format(amount)
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as number)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event

    if (!over) {
      setActiveId(null)
      return
    }

    const activeDeal = deals.find((d) => d.id === active.id)
    if (!activeDeal) {
      setActiveId(null)
      return
    }

    // Check if dropped on a different stage
    const overStage = over.id as string
    if (activeDeal.stage !== overStage) {
      let lostReason: string | undefined
      let quotationId: number | undefined

      // Prompt for lost reason
      if (overStage === 'lost') {
        const reason = prompt(
          'Lý do lost:\n' + LOST_REASONS.map((r, i) => `${i + 1}. ${r.label}`).join('\n') + '\n\nNhập số từ 1-6:'
        )
        if (reason) {
          const idx = parseInt(reason) - 1
          if (idx >= 0 && idx < LOST_REASONS.length) {
            lostReason = LOST_REASONS[idx].value
          }
        }
      }

      // Prompt for quotation link when won
      if (overStage === 'won') {
        const qid = prompt('Nhập ID báo giá liên kết (hoặc để trống):')
        if (qid) {
          quotationId = parseInt(qid)
        }
      }

      // Update stage
      try {
        await updateStageMutation.mutateAsync({
          id: activeDeal.id,
          stage: overStage,
          lostReason,
          quotationId,
        })
      } catch (error) {
        console.error('Failed to update stage:', error)
        alert('Cập nhật stage thất bại')
      }
    }

    setActiveId(null)
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-slate-400">Đang tải pipeline...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-50">Sales Pipeline</h2>
          <p className="text-sm text-slate-400 mt-1">{deals.length} deals</p>
        </div>
        <button
          onClick={() => alert('Create deal modal coming soon')}
          className="btn btn-primary px-4 py-2.5 text-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Tạo deal
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2">
              <Target className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Tổng deals</p>
              <p className="text-xl font-bold text-slate-50">{deals.length}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Won</p>
              <p className="text-xl font-bold text-slate-50">{getStageStats('won').count}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2">
              <DollarSign className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Có trọng số</p>
              <p className="text-xl font-bold text-slate-50">{formatCurrency(totalWeighted)} ₫</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <BarChart3 className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Win Rate</p>
              <p className="text-xl font-bold text-slate-50">
                {deals.length > 0 ? Math.round((getStageStats('won').count / deals.length) * 100) : 0}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_CONFIG.map((stage) => {
            const stageDeals = getDealsByStage(stage.value)
            const stageStat = getStageStats(stage.value)

            return (
              <div key={stage.value} className="flex-shrink-0 w-80">
                {/* Column Header */}
                <div className="card p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={cn('badge border text-xs', stage.color)}>{stage.label}</span>
                      <span className="text-xs text-slate-500">{stageDeals.length}</span>
                    </div>
                    <button
                      onClick={() => alert('Create deal in this stage coming soon')}
                      className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
                      title="Add deal"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-500">
                    Tổng: {formatCurrency(stageStat.totalValue)} ₫
                  </div>
                </div>

                {/* Droppable Area */}
                <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <div
                    id={stage.value}
                    className="space-y-2 min-h-[400px] rounded-lg bg-slate-900/20 border-2 border-dashed border-slate-800 p-2"
                  >
                    {stageDeals.length === 0 ? (
                      <p className="text-center text-slate-600 text-sm py-8">Không có deal</p>
                    ) : (
                      stageDeals.map((deal) => <SortableDealCard key={deal.id} deal={deal} />)
                    )}
                  </div>
                </SortableContext>

                {/* Column Footer */}
                <div className="mt-2 text-xs text-slate-500 px-2">
                  Có trọng số: {formatCurrency(stageStat.weightedValue)} ₫
                </div>
              </div>
            )
          })}
        </div>

        <DragOverlay>
          {activeDeal ? (
            <div className="w-80">
              <DealCard deal={activeDeal} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
