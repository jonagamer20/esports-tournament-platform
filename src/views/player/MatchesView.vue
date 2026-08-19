<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { auth, db, storage } from '../../firebase'
import { collection, query, where, onSnapshot, doc, updateDoc, writeBatch, increment } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'

const matches = ref([])
const loading = ref(true)
const currentUser = ref(null)
let unsubscribe = null

// Modal States
const showScheduleModal = ref(false)
const showResultModal = ref(false)
const selectedGroup = ref(null)
const isSubmitting = ref(false)

// Form Data
const scheduleTime = ref('')
const resultData = ref({
  idaHome: 0,
  idaAway: 0,
  vueltaHome: 0,
  vueltaAway: 0,
  vueltaHome: 0,
  vueltaAway: 0
})

onMounted(() => {
  currentUser.value = auth.currentUser
  if (currentUser.value) {
    const q = query(
      collection(db, 'matches')
    )
    
    unsubscribe = onSnapshot(q, (snapshot) => {
      const allMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      matches.value = allMatches.filter(m => 
        m.homeId === currentUser.value.uid || m.awayId === currentUser.value.uid
      ).sort((a, b) => a.fecha - b.fecha)
      loading.value = false
    })
  }
})

const activeGroups = computed(() => {
  const groups = {}
  matches.value.filter(m => m.status !== 'played').forEach(m => {
    const opponentId = m.homeId === currentUser.value.uid ? m.awayId : m.homeId
    const key = opponentId
    if (!groups[key]) {
      groups[key] = {
        fecha: m.fecha,
        opponentName: m.homeId === currentUser.value.uid ? m.awayName : m.homeName,
        opponentId: opponentId,
        matches: [],
        status: m.status,
        scheduledTime: m.scheduledTime,
        proposedBy: m.proposedBy
      }
    }
    groups[key].matches.push(m)
    if (m.status === 'scheduled') groups[key].status = 'scheduled'
    else if (m.status === 'proposed' && groups[key].status !== 'scheduled') groups[key].status = 'proposed'
    
    if (m.scheduledTime) groups[key].scheduledTime = m.scheduledTime
    if (m.proposedBy) groups[key].proposedBy = m.proposedBy
  })
  return Object.values(groups).sort((a, b) => a.fecha - b.fecha)
})

const historyGroups = computed(() => {
  const groups = {}
  matches.value.filter(m => m.status === 'played').forEach(m => {
    const opponentId = m.homeId === currentUser.value.uid ? m.awayId : m.homeId
    const key = opponentId
    if (!groups[key]) {
      groups[key] = {
        fecha: m.fecha,
        opponentName: m.homeId === currentUser.value.uid ? m.awayName : m.homeName,
        opponentId: opponentId,
        matches: [],
        status: 'played',
        scheduledTime: m.scheduledTime
      }
    }
    groups[key].matches.push(m)
  })
  return Object.values(groups).sort((a, b) => b.fecha - a.fecha) // Newest first
})

const openScheduleModal = (group) => {
  selectedGroup.value = group
  scheduleTime.value = group.scheduledTime || ''
  showScheduleModal.value = true
}

const handlePropose = async () => {
  if (!scheduleTime.value) return
  isSubmitting.value = true
  try {
    const batch = writeBatch(db)
    selectedGroup.value.matches.forEach(m => {
      batch.update(doc(db, 'matches', m.id), {
        scheduledTime: scheduleTime.value,
        proposedBy: currentUser.value.uid,
        status: 'proposed'
      })
    })
    await batch.commit()
    showScheduleModal.value = false
    scheduleTime.value = ''
  } catch (error) {
    console.error(error)
    alert('Error al enviar propuesta')
  } finally {
    isSubmitting.value = false
  }
}

const confirmTime = async (group) => {
  if (confirm('¿Confirmas este horario para ambos partidos?')) {
    try {
      const batch = writeBatch(db)
      group.matches.forEach(m => {
        batch.update(doc(db, 'matches', m.id), {
          status: 'scheduled'
        })
      })
      await batch.commit()
    } catch (error) {
      console.error('Error confirming time:', error)
      alert('Error al confirmar el horario.')
    }
  }
}

const openResultModal = (group) => {
  if (!group || !group.matches || group.matches.length === 0) {
    alert('Error: No se encontraron partidos para esta fecha.')
    return
  }
  selectedGroup.value = group
  resultData.value = {
    idaHome: 0,
    idaAway: 0,
    vueltaHome: 0,
    vueltaAway: 0,
    vueltaHome: 0,
    vueltaAway: 0
  }
  showResultModal.value = true
}



const calculatePoints = (homeScore, awayScore) => {
  if (homeScore > awayScore) return { home: 3, away: 0 }
  if (homeScore < awayScore) return { home: 0, away: 3 }
  return { home: 1, away: 1 }
}

const submitResults = async () => {
  isSubmitting.value = true
  console.log('Iniciando envío de resultados...')
  
  try {
    // 1. Attempt Upload if evidence exists - REMOVED


    console.log('Actualizando base de datos...')
    const batch = writeBatch(db)
    const idaMatch = selectedGroup.value.matches.find(m => m.type === 'Ida')
    const vueltaMatch = selectedGroup.value.matches.find(m => m.type === 'Vuelta')

    if (idaMatch) {
      batch.update(doc(db, 'matches', idaMatch.id), {
        scoreHome: resultData.value.idaHome,
        scoreAway: resultData.value.idaAway,
        status: 'awaiting_approval',
        status: 'awaiting_approval',
        evidenceUrl: null,
        reportedBy: currentUser.value.uid,
        reportedAt: new Date()
      })
    }

    if (vueltaMatch) {
      batch.update(doc(db, 'matches', vueltaMatch.id), {
        scoreHome: resultData.value.vueltaHome,
        scoreAway: resultData.value.vueltaAway,
        status: 'awaiting_approval',
        evidenceUrl: null,
        reportedBy: currentUser.value.uid,
        reportedAt: new Date()
      })
    }

    await batch.commit()
    console.log('Batch commit exitoso')
    
    alert('¡Resultados enviados con éxito! Esperando aprobación del admin.')
    
    showResultModal.value = false
  } catch (error) {
    console.error('Error crítico en el envío:', error)
    alert('Error al enviar: ' + error.message)
  } finally {
    isSubmitting.value = false
  }
}

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-8">
    <header class="mb-12">
      <h1 class="text-4xl font-black gradient-text">Mis Partidos</h1>
      <p class="text-white/40 mt-1">Coordina horarios e ingresa resultados con evidencia</p>
    </header>

    <div v-if="loading" class="text-center p-12 text-white/40">Cargando partidos...</div>

    <div v-else-if="activeGroups.length === 0 && historyGroups.length === 0" class="glass-card text-center p-12">
      <div class="text-6xl mb-6">⚽</div>
      <p class="text-white/40">No tienes partidos pendientes ni historial en este momento.</p>
    </div>

    <div v-else class="space-y-12">
      <!-- Active Matches -->
      <div v-if="activeGroups.length > 0">
        <h2 class="text-2xl font-black mb-6 flex items-center space-x-4">
          <span class="text-primary">Partidos Activos</span>
          <span class="h-px bg-white/10 flex-1"></span>
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div v-for="group in activeGroups" :key="group.opponentId" class="glass-card p-6 border-t-4"
               :class="{
                 'border-t-green-500': group.status === 'scheduled',
                 'border-t-purple-500': group.status === 'awaiting_approval',
                 'border-t-yellow-500': group.status === 'proposed',
                 'border-t-white/10': group.status === 'pending'
               }">
            
            <div class="flex justify-between items-start mb-6">
              <div class="flex flex-col">
                <span class="text-xs font-black text-primary uppercase tracking-wider">Fecha {{ group.fecha }}</span>
                <span class="text-[10px] uppercase font-black text-white/40">Doble Duelo vs {{ group.opponentName }}</span>
              </div>
              <span class="text-[10px] uppercase font-black px-2 py-1 rounded"
                    :class="{
                      'bg-green-500/20 text-green-400': group.status === 'scheduled',
                      'bg-purple-500/20 text-purple-400': group.status === 'awaiting_approval',
                      'bg-yellow-500/20 text-yellow-400': group.status === 'proposed',
                      'bg-white/5 text-white/40': group.status === 'pending'
                    }">
                {{ group.status === 'awaiting_approval' ? 'En Revisión' : group.status === 'scheduled' ? 'Programado' : 'Pendiente' }}
              </span>
            </div>

            <!-- Scheduling Section -->
            <div v-if="group.status !== 'awaiting_approval'" class="bg-white/5 rounded-xl p-4 border border-white/5 mb-4">
              <div v-if="group.scheduledTime" class="flex items-center justify-between">
                <div>
                  <p class="text-[10px] uppercase text-white/40 font-bold">Horario</p>
                  <p class="font-bold" :class="group.status === 'scheduled' ? 'text-green-400' : 'text-primary'">{{ group.scheduledTime }}</p>
                </div>
                <div v-if="group.status === 'proposed' && group.proposedBy !== currentUser.uid" class="flex space-x-2">
                  <button @click="confirmTime(group)" class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 text-xs font-bold rounded-lg transition-all shadow-lg shadow-green-500/20">Aceptar</button>
                  <button @click="openScheduleModal(group)" class="bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 text-xs font-bold rounded-lg transition-all">Refutar</button>
                </div>
              </div>
              <div v-else class="text-center">
                <button @click="openScheduleModal(group)" class="w-full py-2 border border-primary/30 text-primary text-xs font-bold rounded-lg hover:bg-primary/10 transition-all">
                  Proponer Horario
                </button>
              </div>
            </div>

            <!-- Results Button -->
            <div v-if="group.status === 'scheduled'">
              <button @click="openResultModal(group)"
                      class="w-full py-3 bg-primary text-secondary text-sm font-black rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center space-x-2 shadow-lg shadow-primary/20">
                <span>⚽ INGRESAR RESULTADOS</span>
              </button>
            </div>
            <div v-else-if="group.status === 'awaiting_approval'" class="text-center p-4 bg-purple-500/10 rounded-xl border border-purple-500/20">
              <p class="text-[10px] text-purple-400 uppercase font-black">Resultados en revisión</p>
              <p class="text-[9px] text-white/40 mt-1">El admin está verificando los goles. Los puntos se sumarán pronto.</p>
            </div>
            <div v-else class="text-center p-3 bg-white/5 rounded-xl border border-dashed border-white/10">
              <p class="text-[10px] text-white/20 uppercase font-black">Resultados bloqueados</p>
              <p class="text-[9px] text-white/40 mt-1">Debes confirmar el horario para poder ingresar los resultados.</p>
            </div>

            <div v-if="group.status === 'proposed' && group.proposedBy === currentUser.uid" class="mt-4 text-center">
              <p class="text-[10px] text-white/40 italic">Esperando respuesta de {{ group.opponentName }}...</p>
              <button @click="openScheduleModal(group)" class="mt-2 text-[10px] text-primary hover:underline font-bold uppercase">Cambiar mi propuesta</button>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="text-center p-8 bg-white/5 rounded-2xl border border-white/5">
        <p class="text-white/40 font-bold">No tienes partidos activos por ahora.</p>
      </div>

      <!-- History Section -->
      <div v-if="historyGroups.length > 0">
        <h2 class="text-2xl font-black mb-6 flex items-center space-x-4">
          <span class="text-white/40">Historial de Partidos</span>
          <span class="h-px bg-white/10 flex-1"></span>
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div v-for="group in historyGroups" :key="group.opponentId" class="glass-card p-6 border-t-4 border-t-white/10 opacity-75 hover:opacity-100 transition-opacity">
            <div class="flex justify-between items-start mb-6">
              <div class="flex flex-col">
                <span class="text-xs font-black text-white/40 uppercase tracking-wider">Fecha {{ group.fecha }}</span>
                <span class="text-[10px] uppercase font-black text-white/40">vs {{ group.opponentName }}</span>
              </div>
              <span class="text-[10px] uppercase font-black px-2 py-1 rounded bg-white/5 text-white/40">
                Finalizado
              </span>
            </div>

            <div class="space-y-4">
              <div v-for="match in group.matches" :key="match.id" class="bg-white/5 p-3 rounded-xl border border-white/5">
                <p class="text-[10px] uppercase font-black text-white/20 mb-1 text-center">{{ match.type }}</p>
                <div class="flex justify-between items-center">
                  <span class="text-xs font-bold" :class="match.scoreHome > match.scoreAway ? 'text-green-400' : (match.scoreHome < match.scoreAway ? 'text-red-400' : 'text-white/60')">
                    {{ match.homeName }}
                  </span>
                  <span class="text-lg font-black bg-black/20 px-3 py-1 rounded-lg">
                    {{ match.scoreHome }} - {{ match.scoreAway }}
                  </span>
                  <span class="text-xs font-bold" :class="match.scoreAway > match.scoreHome ? 'text-green-400' : (match.scoreAway < match.scoreHome ? 'text-red-400' : 'text-white/60')">
                    {{ match.awayName }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Schedule Modal -->
    <div v-if="showScheduleModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-secondary/90 backdrop-blur-md">
      <div class="glass-card max-w-md w-full animate-fade-in border-primary/20">
        <h3 class="text-2xl font-black mb-2">{{ selectedGroup.scheduledTime ? 'Refutar Horario' : 'Proponer Horario' }}</h3>
        <p class="text-white/40 mb-8 text-sm">
          {{ selectedGroup.scheduledTime ? `El rival propuso ${selectedGroup.scheduledTime}. Sugiere otra hora:` : 'Indica el día y la hora para jugar ambos partidos.' }}
        </p>
        
        <div class="relative mb-8">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-xl">📅</span>
          <input v-model="scheduleTime" type="text" placeholder="Ej: Sábado 21:00" 
                 class="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-white outline-none focus:border-primary transition-all">
        </div>
        
        <div class="flex space-x-3">
          <button @click="showScheduleModal = false" class="flex-1 py-4 text-white/40 font-bold hover:text-white transition-all">Cancelar</button>
          <button @click="handlePropose" :disabled="isSubmitting" class="flex-[2] btn-primary py-4">
            {{ isSubmitting ? 'Enviando...' : 'Confirmar Propuesta' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Result Modal -->
    <div v-show="showResultModal" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
      <div v-if="selectedGroup" class="glass-card max-w-lg w-full max-h-[90vh] overflow-y-auto border-primary/20">
        <div class="flex justify-between items-center mb-8">
          <h3 class="text-2xl font-black">Ingresar Resultados</h3>
          <span class="bg-primary/10 text-primary text-[10px] font-black px-3 py-1 rounded-full border border-primary/20">FECHA {{ selectedGroup.fecha }}</span>
        </div>
        
        <div class="space-y-6">
          <!-- Ida -->
          <div v-if="selectedGroup.matches.some(m => m.type === 'Ida')" class="p-6 bg-white/5 rounded-3xl border border-white/10">
            <p class="text-[10px] font-black text-primary uppercase mb-6 tracking-widest">Partido 1: IDA</p>
            <div class="flex items-center justify-between space-x-4">
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-primary mb-1">Local</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ selectedGroup.matches.find(m => m.type === 'Ida')?.homeName }}</p>
                <input v-model.number="resultData.idaHome" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
              <div class="text-2xl font-black text-white/10 italic">VS</div>
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-white/40 mb-1">Visitante</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ selectedGroup.matches.find(m => m.type === 'Ida')?.awayName }}</p>
                <input v-model.number="resultData.idaAway" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
            </div>
          </div>
          <div v-else class="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-center">
            <p class="text-[10px] text-red-400 font-black uppercase">Partido de Ida no encontrado</p>
          </div>

          <!-- Vuelta -->
          <div v-if="selectedGroup.matches.some(m => m.type === 'Vuelta')" class="p-6 bg-white/5 rounded-3xl border border-white/10">
            <p class="text-[10px] font-black text-primary uppercase mb-6 tracking-widest">Partido 2: VUELTA</p>
            <div class="flex items-center justify-between space-x-4">
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-primary mb-1">Local</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ selectedGroup.matches.find(m => m.type === 'Vuelta')?.homeName }}</p>
                <input v-model.number="resultData.vueltaHome" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
              <div class="text-2xl font-black text-white/10 italic">VS</div>
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-white/40 mb-1">Visitante</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ selectedGroup.matches.find(m => m.type === 'Vuelta')?.awayName }}</p>
                <input v-model.number="resultData.vueltaAway" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
            </div>
          </div>
          <div v-else class="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-center">
            <p class="text-[10px] text-red-400 font-black uppercase">Partido de Vuelta no encontrado</p>
          </div>


        </div>

        <div class="flex space-x-3 mt-8">
          <button @click="showResultModal = false" class="flex-1 py-4 text-white/40 font-bold hover:text-white transition-all">Cancelar</button>
          <button @click="submitResults" :disabled="isSubmitting" class="flex-[2] btn-primary py-4">
            {{ isSubmitting ? 'Enviando...' : 'Confirmar Resultados' }}
          </button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

input[type=number]::-webkit-inner-spin-button, 
input[type=number]::-webkit-outer-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}
</style>
