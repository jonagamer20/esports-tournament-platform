<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { db } from '../../firebase'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'

const matches = ref([])
const loading = ref(true)
let unsubscribe = null

onMounted(() => {
  const q = query(
    collection(db, 'matches'),
    orderBy('fecha', 'asc')
  )
  
  unsubscribe = onSnapshot(q, (snapshot) => {
    matches.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    loading.value = false
  })
})

const currentPage = ref(1)
const itemsPerPage = 6

// Filters
const filterGroup = ref('all')
const filterPlayer = ref('all')
const filterFecha = ref('all')

const availablePlayers = computed(() => {
  const players = new Set()
  matches.value.forEach(m => {
    if (m.homeName) players.add(m.homeName)
    if (m.awayName) players.add(m.awayName)
  })
  return Array.from(players).sort()
})

const availableFechas = computed(() => {
  const fechas = new Set()
  matches.value.forEach(m => {
    if (m.fecha) fechas.add(m.fecha)
  })
  return Array.from(fechas).sort((a, b) => a - b)
})

const filteredPairs = computed(() => {
  const pairs = []
  const processedKeys = new Set()

  matches.value.forEach(m => {
    // Apply Filters
    if (filterGroup.value !== 'all' && m.group !== filterGroup.value) return
    if (filterFecha.value !== 'all' && m.fecha !== Number(filterFecha.value)) return
    if (filterPlayer.value !== 'all' && m.homeName !== filterPlayer.value && m.awayName !== filterPlayer.value) return

    // Group by pair
    const players = [m.homeId, m.awayId].sort()
    const pairKey = players.join('_')
    
    if (processedKeys.has(pairKey)) return
    
    // Find the other match of the pair
    const otherMatch = matches.value.find(om => 
      om.id !== m.id && 
      ((om.homeId === m.homeId && om.awayId === m.awayId) || (om.homeId === m.awayId && om.awayId === m.homeId))
    )

    // Determine status for the pair
    let status = 'pending'
    let scheduledTime = null
    
    // Check both matches for status priority
    const statuses = [m.status, otherMatch?.status].filter(Boolean)
    if (statuses.includes('played')) status = 'played'
    else if (statuses.includes('scheduled')) status = 'scheduled'
    else if (statuses.includes('proposed')) status = 'proposed'
    else if (statuses.includes('awaiting_approval')) status = 'awaiting_approval'
    
    if (m.scheduledTime) scheduledTime = m.scheduledTime
    if (otherMatch?.scheduledTime) scheduledTime = otherMatch.scheduledTime

    // Identify Ida and Vuelta
    const ida = m.type === 'Ida' ? m : otherMatch
    const vuelta = m.type === 'Vuelta' ? m : otherMatch

    pairs.push({
      pairKey,
      fecha: m.fecha,
      homeName: m.homeName,
      awayName: m.awayName,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      group: m.group,
      scheduledTime,
      status,
      isDouble: true,
      ida: ida ? { scoreHome: ida.scoreHome, scoreAway: ida.scoreAway, status: ida.status } : null,
      vuelta: vuelta ? { scoreHome: vuelta.scoreHome, scoreAway: vuelta.scoreAway, status: vuelta.status } : null
    })
    
    processedKeys.add(pairKey)
  })
  
  return pairs.sort((a, b) => a.fecha - b.fecha)
})

const totalPages = computed(() => Math.ceil(filteredPairs.value.length / itemsPerPage))

const paginatedPairsByFecha = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  const end = start + itemsPerPage
  const pageItems = filteredPairs.value.slice(start, end)
  
  const fechas = {}
  pageItems.forEach(p => {
    if (!fechas[p.fecha]) fechas[p.fecha] = {}
    fechas[p.fecha][p.pairKey] = p
  })
  return fechas
})

const nextPage = () => {
  if (currentPage.value < totalPages.value) currentPage.value++
}

const prevPage = () => {
  if (currentPage.value > 1) currentPage.value--
}

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-8">
    <header class="mb-12">
      <h1 class="text-4xl font-black gradient-text">Calendario Oficial</h1>
      <p class="text-white/40 mt-1">Hoja de ruta de la Masturbanda League Cup (Ida y Vuelta el mismo día)</p>
    </header>

    <!-- Filters -->
    <div class="mb-8 flex flex-wrap gap-4">
      <!-- Group Filter -->
      <div class="relative">
        <select v-model="filterGroup" class="appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-primary transition-all pr-8 cursor-pointer hover:bg-white/10">
          <option value="all" class="bg-gray-900 text-white">Todos los Grupos</option>
          <option value="A" class="bg-gray-900 text-white">Grupo A</option>
          <option value="B" class="bg-gray-900 text-white">Grupo B</option>
        </select>
        <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40 text-[10px]">▼</div>
      </div>

      <!-- Player Filter -->
      <div class="relative">
        <select v-model="filterPlayer" class="appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-primary transition-all pr-8 cursor-pointer hover:bg-white/10">
          <option value="all" class="bg-gray-900 text-white">Todos los Jugadores</option>
          <option v-for="player in availablePlayers" :key="player" :value="player" class="bg-gray-900 text-white">{{ player }}</option>
        </select>
        <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40 text-[10px]">▼</div>
      </div>

      <!-- Fecha Filter -->
      <div class="relative">
        <select v-model="filterFecha" class="appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-primary transition-all pr-8 cursor-pointer hover:bg-white/10">
          <option value="all" class="bg-gray-900 text-white">Todas las Fechas</option>
          <option v-for="f in availableFechas" :key="f" :value="f" class="bg-gray-900 text-white">Fecha {{ f }}</option>
        </select>
        <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/40 text-[10px]">▼</div>
      </div>
    </div>

    <div v-if="loading" class="text-center p-12 text-white/40">Cargando calendario...</div>

    <div v-else-if="filteredPairs.length === 0" class="glass-card text-center p-12">
      <div class="text-6xl mb-6">📅</div>
      <h3 class="text-2xl font-bold mb-2">No hay partidos programados</h3>
      <p class="text-white/40 max-w-md mx-auto">
        Los partidos aparecerán aquí cuando se programen o se jueguen.
      </p>
    </div>

    <div v-else class="space-y-12">
      <div v-for="(pairs, fechaNum) in paginatedPairsByFecha" :key="fechaNum">
        <h2 class="text-2xl font-black mb-6 flex items-center space-x-4">
          <span class="text-primary">FECHA {{ fechaNum }}</span>
          <span class="h-px bg-white/10 flex-1"></span>
        </h2>

        <div class="grid grid-cols-1 gap-4">
          <div v-for="(match, pairKey) in pairs" :key="pairKey" 
               class="glass-card flex flex-col md:flex-row items-center justify-between p-6 hover:border-primary/30 transition-all"
               :class="match.status === 'scheduled' ? 'border-l-4 border-l-green-500' : 'border-l-4 border-l-white/5'">
            
            <div class="flex items-center space-x-4 mb-4 md:mb-0 min-w-[200px]">
              <div :class="match.status === 'scheduled' ? 'bg-primary/10 border-primary/20' : 'bg-white/5 border-white/10'" 
                   class="px-4 py-2 rounded-xl border text-center min-w-[120px]">
                <p class="text-[10px] uppercase font-black text-white/40">Horario</p>
                <p class="font-bold" :class="match.status === 'scheduled' ? 'text-primary' : 'text-white/20'">
                  {{ match.scheduledTime || 'TBD' }}
                </p>
              </div>
              <div>
                <span class="text-[10px] uppercase font-black px-2 py-1 bg-white/5 rounded border border-white/10">
                  G{{ match.group }}
                </span>
                <p class="text-[10px] text-primary mt-1 uppercase font-bold">Doble Duelo</p>
              </div>
            </div>

            <div class="flex flex-col items-center flex-1 px-4">
              <div class="flex items-center justify-between w-full mb-2">
                <div class="flex flex-col items-end flex-1">
                  <span class="font-bold text-lg leading-tight">{{ match.homeName }}</span>
                  <span class="text-[10px] text-primary font-black uppercase italic">{{ match.homeTeam }}</span>
                </div>
                <span class="text-xs font-black text-white/20 mx-4 uppercase">VS</span>
                <div class="flex flex-col items-start flex-1">
                  <span class="font-bold text-lg leading-tight">{{ match.awayName }}</span>
                  <span class="text-[10px] text-primary font-black uppercase italic">{{ match.awayTeam }}</span>
                </div>
              </div>

              <!-- Scores Section -->
              <div v-if="match.status === 'played'" class="flex space-x-4 w-full justify-center">
                <div class="flex flex-col items-center bg-black/20 px-3 py-1 rounded-lg border border-white/5">
                  <span class="text-[9px] text-white/40 uppercase font-bold mb-1">IDA</span>
                  <span class="font-black text-primary">{{ match.ida?.scoreHome ?? '-' }} - {{ match.ida?.scoreAway ?? '-' }}</span>
                </div>
                <div class="flex flex-col items-center bg-black/20 px-3 py-1 rounded-lg border border-white/5">
                  <span class="text-[9px] text-white/40 uppercase font-bold mb-1">VUELTA</span>
                  <span class="font-black text-primary">{{ match.vuelta?.scoreHome ?? '-' }} - {{ match.vuelta?.scoreAway ?? '-' }}</span>
                </div>
              </div>
              <div v-else class="text-xs font-bold text-white/20 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full">
                {{ match.status === 'scheduled' ? 'Por Jugar' : 'Pendiente' }}
              </div>
            </div>

            <div class="mt-4 md:mt-0 min-w-[120px] text-right">
              <span v-if="match.status === 'scheduled'" class="px-4 py-1 bg-green-500/10 text-green-500 text-xs font-bold rounded-full border border-green-500/20 uppercase">
                Confirmado
              </span>
              <span v-else-if="match.status === 'played'" class="px-4 py-1 bg-blue-500/10 text-blue-500 text-xs font-bold rounded-full border border-blue-500/20 uppercase">
                Finalizado
              </span>
              <span v-else class="px-4 py-1 bg-white/5 text-white/20 text-xs font-bold rounded-full border border-white/10 uppercase">
                {{ match.status === 'awaiting_approval' ? 'En Revisión' : 'Pendiente' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination Controls -->
      <div v-if="totalPages > 1" class="flex justify-center items-center space-x-4 pt-8 border-t border-white/5">
        <button 
          @click="prevPage" 
          :disabled="currentPage === 1"
          class="px-4 py-2 bg-white/5 rounded-lg border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          ← Anterior
        </button>
        <span class="text-xs font-black text-white/40">Página {{ currentPage }} de {{ totalPages }}</span>
        <button 
          @click="nextPage" 
          :disabled="currentPage === totalPages"
          class="px-4 py-2 bg-white/5 rounded-lg border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          Siguiente →
        </button>
      </div>
    </div>
  </main>
</template>
