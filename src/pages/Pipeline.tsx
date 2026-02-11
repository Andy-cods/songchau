import { useState } from 'react'
import { Plus, TrendingUp, DollarSign, Target, BarChart3, GripVertical } from 'lucide-react'
import { usePipeline, usePipelineStats, useUpdateDealStage } from '@/hooks/usePipeline'
import DealForm from '@/components/pipeline/DealForm'
import DealDetail from '@/components/pipeline/DealDetail'
import StageChangeModal from '@/components/pipeline/StageChangeModal'
import { type PipelineDeal } from '@/lib/api'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { useToast } from '@/hooks/use-toast'
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
  { value: 'lead', label: 'Lead', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  { value: 'qualified', label: 'Qualified', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  { value: 'proposal', label: 'Proposal', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  { value: 'negotiation', label: 'Negotiation', color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  { value: 'won', label: 'Won', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  { value: 'lost', label: 'Lost', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
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
        'rounded-lg bg-stone-800 border border-stone-700/50 p-4 group',
        'hover:border-stone-600 hover:shadow-md transition-all',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-white mb-0.5">{deal.customerName || 'No customer'}</h3>
          <p className="text-xs text-stone-400">{deal.title}</p>
        </div>
        <GripVertical className="h-4 w-4 text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2" />
      </div>

      <div className="flex items-center gap-3 mt-3">
        {deal.dealValue && (
          <span className="badge bg-brand-500/10 text-brand-400 border-brand-500/20 text-xs px-2 py-0.5">
            {formatCurrency(deal.dealValue)}
          </span>
        )}
        {deal.probability !== null && deal.probability !== undefined && (
          <span className="text-xs text-stone-500">{deal.probability}%</span>
        )}
        {deal.expectedCloseDate && (
          <span className="text-xs text-stone-500 ml-auto">
            {format(new Date(deal.expectedCloseDate), 'dd/MM')}
          </span>
        )}
      </div>
    </div>
  )
}

function SortableDealCard({ deal, onClick }: { deal: PipelineDeal; onClick?: () => void }) {
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
      <DealCard deal={deal} isDragging={isDragging} onClick={onClick} />
    </div>
  )
}

export default function Pipeline() {
  const [activeId, setActiveId] = useState<number | null>(null)
  const [isDealFormOpen, setIsDealFormOpen] = useState(false)
  const [dealFormStage, setDealFormStage] = useState<string>('lead')
  const [stageChangeModal, setStageChangeModal] = useState<{ open: boolean; type: 'lost' | 'won'; dealId: number; stage: string }>({ open: false, type: 'lost', dealId: 0, stage: '' })
  const [selectedDeal, setSelectedDeal] = useState<PipelineDeal | null>(null)
  const [isDealDetailOpen, setIsDealDetailOpen] = useState(false)
  const { toast } = useToast()

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
      // Show modal for lost/won stages
      if (overStage === 'lost' || overStage === 'won') {
        setStageChangeModal({ open: true, type: overStage as 'lost' | 'won', dealId: activeDeal.id, stage: overStage })
        setActiveId(null)
        return
      }

      // Direct stage change for other stages
      try {
        await updateStageMutation.mutateAsync({
          id: activeDeal.id,
          stage: overStage,
        })
        toast({ title: `Chuyển sang ${overStage} thành công` })
      } catch (error) {
        console.error('Failed to update stage:', error)
        toast({ title: 'Cập nhật stage thất bại', variant: 'destructive' })
      }
    }

    setActiveId(null)
  }

  const handleStageChangeConfirm = async (data: { lostReason?: string; quotationId?: number }) => {
    try {
      await updateStageMutation.mutateAsync({
        id: stageChangeModal.dealId,
        stage: stageChangeModal.stage,
        lostReason: data.lostReason,
        quotationId: data.quotationId,
      })
      toast({ title: `Chuyển sang ${stageChangeModal.stage} thành công` })
      setStageChangeModal((prev) => ({ ...prev, open: false }))
    } catch (error) {
      console.error('Failed to update stage:', error)
      toast({ title: 'Cập nhật stage thất bại', variant: 'destructive' })
    }
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  const activeDeal = activeId ? deals.find((d) => d.id === activeId) : null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-stone-400">Đang tải pipeline...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-stone-50">Sales Pipeline</h2>
          <p className="text-sm text-stone-400 mt-1">{deals.length} deals</p>
        </div>
        <button
          onClick={() => { setDealFormStage('lead'); setIsDealFormOpen(true) }}
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
            <div className="rounded-lg bg-amber-500/10 p-2">
              <Target className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-stone-400">Tổng deals</p>
              <p className="text-xl font-bold text-stone-50">{deals.length}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs text-stone-400">Won</p>
              <p className="text-xl font-bold text-stone-50">{getStageStats('won').count}</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <DollarSign className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-stone-400">Có trọng số</p>
              <p className="text-xl font-bold text-stone-50">{formatCurrency(totalWeighted)} ₫</p>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2">
              <BarChart3 className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs text-stone-400">Win Rate</p>
              <p className="text-xl font-bold text-stone-50">
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
                      <span className="text-xs text-stone-500">{stageDeals.length}</span>
                    </div>
                    <button
                      onClick={() => { setDealFormStage(stage.value); setIsDealFormOpen(true) }}
                      className="p-1 rounded hover:bg-stone-700/50 text-stone-400 hover:text-white transition-colors"
                      title="Add deal"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-stone-500">
                    Tổng: {formatCurrency(stageStat.totalValue)} ₫
                  </div>
                </div>

                {/* Droppable Area */}
                <SortableContext items={stageDeals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
                  <div
                    id={stage.value}
                    className="space-y-2 min-h-[400px] rounded-lg bg-stone-900/20 border-2 border-dashed border-stone-800 p-2"
                  >
                    {stageDeals.length === 0 ? (
                      <p className="text-center text-stone-600 text-sm py-8">Không có deal</p>
                    ) : (
                      stageDeals.map((deal) => (
                        <SortableDealCard
                          key={deal.id}
                          deal={deal}
                          onClick={() => { setSelectedDeal(deal); setIsDealDetailOpen(true) }}
                        />
                      ))
                    )}
                  </div>
                </SortableContext>

                {/* Column Footer */}
                <div className="mt-2 text-xs text-stone-500 px-2">
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

      {/* Deal Detail Slide-over */}
      <DealDetail
        deal={selectedDeal}
        isOpen={isDealDetailOpen}
        onClose={() => setIsDealDetailOpen(false)}
        onEdit={(deal) => {
          setIsDealDetailOpen(false)
          setSelectedDeal(deal)
          setDealFormStage(deal.stage)
          setIsDealFormOpen(true)
        }}
      />

      {/* Deal Form Modal */}
      <DealForm
        isOpen={isDealFormOpen}
        onClose={() => setIsDealFormOpen(false)}
        deal={isDealFormOpen && selectedDeal ? selectedDeal : undefined}
        defaultStage={dealFormStage}
      />

      {/* Stage Change Modal (Lost/Won) */}
      <StageChangeModal
        isOpen={stageChangeModal.open}
        type={stageChangeModal.type}
        onConfirm={handleStageChangeConfirm}
        onCancel={() => setStageChangeModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
