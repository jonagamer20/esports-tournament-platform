<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { db } from '../../firebase'
import { collection, onSnapshot, addDoc, writeBatch, doc } from 'firebase/firestore'

const allPlayers = ref([])
const selectedPlayerIds = ref([])
const pots = ref([[], [], [], []])
const groups = ref({ A: [], B: [], C: [], D: [] })
const loading = ref(false)
const step = ref(1) // 1: List, 2: Pots, 3: Groups
let unsubscribe = null

const FIFA_TEAMS = [
  "Argentina", "Francia", "España", "Inglaterra", 
  "Brasil", "Bélgica", "Portugal", "Países Bajos", 
  "Italia", "Colombia", "Croacia", "Alemania", 
  "Marruecos", "Uruguay", "EE.UU.", "México"
]

onMounted(() => {
  const q = collection(db, 'users')
  unsubscribe = onSnapshot(q, (querySnapshot) => {
    allPlayers.value = querySnapshot.docs
      .filter(d => d.data().role === 'player')
      .map(doc => ({ id: doc.id, ...doc.data() }))
    
    // Auto-select if exactly 16
    if (allPlayers.value.length === 16 && selectedPlayerIds.value.length === 0) {
      selectedPlayerIds.value = allPlayers.value.map(p => p.id)
    }
  })
})

const players = computed(() => {
  return allPlayers.value.filter(p => selectedPlayerIds.value.includes(p.id))
})

const togglePlayer = (player) => {
  const index = selectedPlayerIds.value.indexOf(player.id)
  if (index > -1) {
    selectedPlayerIds.value.splice(index, 1)
  } else {
    if (selectedPlayerIds.value.length < 16) {
      selectedPlayerIds.value.push(player.id)
    }
  }
}

const isSelected = (id) => selectedPlayerIds.value.includes(id)

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})

const drawTeams = () => {
  if (players.value.length < 16) {
    alert("Se necesitan 16 jugadores para el sorteo.")
    return
  }

  const shuffledTeams = [...FIFA_TEAMS].sort(() => 0.5 - Math.random())
  players.value.forEach((player, index) => {
    player.assignedTeam = shuffledTeams[index]
  })
  
  alert("¡Equipos FIFA asignados aleatoriamente!")
}

const generatePots = () => {
  // Check if teams were drawn
  const allAssigned = players.value.every(p => p.assignedTeam)
  if (!allAssigned) {
    if (!confirm("No has sorteado los equipos FIFA aún. ¿Deseas continuar sin asignar equipos?")) {
      return
    }
  }

  // Group players by level (1 and 2)
  const p1 = players.value.filter(p => p.level === 1)
  const p2 = players.value.filter(p => p.level === 2 || !p.level)

  if (p1.length !== 8 || p2.length !== 8) {
    alert(`Error: Debes asignar exactamente 8 jugadores al Nivel 1 y 8 al Nivel 2. Actualmente tienes: Nivel 1: ${p1.length}, Nivel 2: ${p2.length}`)
    return
  }

  pots.value = [p1, p2]
  step.value = 2
}

const drawGroups = () => {
  const tempGroups = { A: [], B: [], C: [], D: [] }
  const groupNames = ['A', 'B', 'C', 'D']
  
  // For each pot (1 and 2)
  pots.value.forEach(pot => {
    // Shuffle the pot
    const shuffledPot = [...pot].sort(() => 0.5 - Math.random())
    
    // Assign 2 players from this pot to each group
    shuffledPot.forEach((player, index) => {
      const groupIndex = Math.floor(index / 2)
      tempGroups[groupNames[groupIndex]].push(player)
    })
  })
  
  groups.value = tempGroups
  step.value = 3
}

const tournamentPassword = ref('')
const showPasswordModal = ref(false)
const MASTER_PASSWORD = 'MB2026' // Puedes cambiar esta contraseña

const handleSaveClick = () => {
  showPasswordModal.value = true
}

const saveTournament = async () => {
  if (tournamentPassword.value !== MASTER_PASSWORD) {
    alert('Contraseña incorrecta. Solo los administradores autorizados pueden iniciar el torneo.')
    return
  }

  loading.value = true
  try {
    const batch = writeBatch(db)
    
    // Save teams/groups
    Object.entries(groups.value).forEach(([groupName, groupPlayers]) => {
      groupPlayers.forEach(player => {
        const userRef = doc(db, 'users', player.id)
        const updateData = { 
          group: groupName, 
          points: 0 
        }
        
        // If a team was assigned during this session, save it
        if (player.assignedTeam) {
          updateData.team = player.assignedTeam
        }
        
        batch.update(userRef, updateData)
      })

      // Generate Matches
      const schedule = [
        [[0, 3], [1, 2]], // Fecha 1
        [[3, 2], [0, 1]], // Fecha 2
        [[1, 3], [2, 0]]  // Fecha 3
      ]

      schedule.forEach((fechaMatches, index) => {
        const fechaNum = index + 1
        
        fechaMatches.forEach(([homeIdx, awayIdx]) => {
          const pHome = groupPlayers[homeIdx]
          const pAway = groupPlayers[awayIdx]

          // Ida (Fechas 1, 2, 3)
          const matchIdaRef = doc(collection(db, 'matches'))
          batch.set(matchIdaRef, {
            homeId: pHome.id,
            awayId: pAway.id,
            homeName: pHome.displayName,
            awayName: pAway.displayName,
            homeTeam: pHome.assignedTeam || pHome.team || 'Sin Equipo',
            awayTeam: pAway.assignedTeam || pAway.team || 'Sin Equipo',
            group: groupName,
            fecha: fechaNum,
            type: 'Ida',
            status: 'pending',
            scoreHome: null,
            scoreAway: null,
            scheduledTime: null,
            proposedBy: null,
            createdAt: new Date()
          })

          // Vuelta (Fechas 4, 5, 6)
          const matchVueltaRef = doc(collection(db, 'matches'))
          batch.set(matchVueltaRef, {
            homeId: pAway.id,
            awayId: pHome.id,
            homeName: pAway.displayName,
            awayName: pHome.displayName,
            homeTeam: pAway.assignedTeam || pAway.team || 'Sin Equipo',
            awayTeam: pHome.assignedTeam || pHome.team || 'Sin Equipo',
            group: groupName,
            fecha: fechaNum + 3,
            type: 'Vuelta',
            status: 'pending',
            scoreHome: null,
            scoreAway: null,
            scheduledTime: null,
            proposedBy: null,
            createdAt: new Date()
          })
        })
      })
    })

    await batch.commit()
    alert('¡Torneo iniciado! Equipos asignados y 6 fechas generadas con éxito.')
    showPasswordModal.value = false
    step.value = 1 
  } catch (error) {
    console.error(error)
    alert('Error al guardar el torneo')
  } finally {
    loading.value = false
  }
}



// onMounted logic is now handled above with onSnapshot
</script>

<template>
  <main class="p-8">
    <header class="mb-12 flex justify-between items-end">
      <div>
        <h1 class="text-4xl font-black gradient-text">Configuración del Torneo</h1>
        <p class="text-white/40 mt-1">Sorteo de bombos y grupos</p>
      </div>
      <div class="flex space-x-2">
        <div v-for="i in 3" :key="i" 
             class="w-3 h-3 rounded-full" 
             :class="step >= i ? 'bg-primary' : 'bg-white/10'"></div>
      </div>
    </header>

    <!-- Step 1: Player Selection -->
    <section v-if="step === 1" class="animate-fade">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        <!-- Selection Sidebar -->
        <div class="lg:col-span-1 glass-card border-l-4 border-l-primary/30">
          <div class="mb-6">
            <h3 class="text-xl font-bold flex items-center gap-2">
              <span class="text-primary">📋</span> Pool de Jugadores
            </h3>
            <p class="text-xs text-white/40 mt-1">Selecciona los 16 participantes para este torneo.</p>
          </div>

          <div class="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            <div v-for="player in allPlayers" :key="player.id" 
                 @click="togglePlayer(player)"
                 class="p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-center group"
                 :class="isSelected(player.id) 
                    ? 'bg-primary/10 border-primary shadow-[0_0_15px_rgba(255,184,0,0.05)]' 
                    : 'bg-white/5 border-white/10 hover:border-white/20'">
              
              <div class="flex items-center gap-3">
                <div class="w-5 h-5 rounded flex items-center justify-center border transition-all"
                     :class="isSelected(player.id) ? 'bg-primary border-primary text-black' : 'border-white/20 text-transparent'">
                  <span class="text-[10px] font-black">✓</span>
                </div>
                <div>
                  <div class="font-bold text-sm" :class="isSelected(player.id) ? 'text-primary' : 'text-white'">{{ player.displayName }}</div>
                  <div class="text-[9px] uppercase font-black" :class="player.level === 1 ? 'text-yellow-500/60' : 'text-white/20'">
                    Nivel {{ player.level === 1 ? 1 : 2 }}
                  </div>
                </div>
              </div>

              <div v-if="player.team && !isSelected(player.id)" class="text-[8px] text-white/20 font-black uppercase text-right">
                Anterior: {{ player.team }}
              </div>
            </div>

            <div v-if="allPlayers.length === 0" class="py-12 text-center">
              <span class="text-4xl block mb-2">🤷‍♂️</span>
              <p class="text-sm text-white/40">No hay jugadores registrados con el rol "player".</p>
            </div>
          </div>
        </div>

        <!-- Drawing Grid -->
        <div class="lg:col-span-2 glass-card relative overflow-hidden">
          <!-- Progress Indicator -->
          <div class="absolute top-0 left-0 w-full h-1 bg-white/5">
            <div class="h-full bg-primary transition-all duration-500" :style="{ width: `${(selectedPlayerIds.length / 16) * 100}%` }"></div>
          </div>

          <div class="flex justify-between items-center mb-8">
            <div>
              <h3 class="text-2xl font-black italic">Sorteo: Copa {{ selectedPlayerIds.length }}/16</h3>
              <p class="text-xs text-white/40">
                Balance de Niveles: 
                <span :class="players.filter(p => p.level === 1).length === 8 ? 'text-primary font-bold' : 'text-white/40'">
                  N1: {{ players.filter(p => p.level === 1).length }}/8
                </span>
                <span class="mx-2">|</span>
                <span :class="players.filter(p => p.level === 2 || !p.level).length === 8 ? 'text-primary font-bold' : 'text-white/40'">
                  N2: {{ players.filter(p => p.level === 2 || !p.level).length }}/8
                </span>
              </p>
            </div>
            <button @click="drawTeams" :disabled="selectedPlayerIds.length < 16" class="px-6 py-3 bg-primary/20 text-primary border border-primary/30 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-primary/30 transition-all disabled:opacity-20 disabled:grayscale">
              Sortear Equipos FIFA
            </button>
          </div>
          
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div v-for="player in players" :key="player.id" class="p-3 bg-primary/5 rounded-xl border border-primary/20 flex flex-col items-center justify-center relative overflow-hidden animate-pop">
              <!-- Team Badge Overlay -->
              <div v-if="player.assignedTeam || player.team" class="absolute -right-2 -top-2 w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center rotate-12 border border-primary/20">
                <span class="text-[8px] font-black text-primary uppercase">⚽</span>
              </div>

              <span class="font-bold relative z-10 text-center text-sm">{{ player.displayName }}</span>
              <span class="text-[8px] uppercase font-black px-2 py-0.5 rounded mt-1 relative z-10"
                    :class="{
                      'bg-yellow-500/20 text-yellow-500': player.level === 1,
                      'bg-white/10 text-white/40': player.level === 2 || !player.level
                    }">
                Nivel {{ player.level === 1 ? 1 : 2 }}
              </span>
              
              <div v-if="player.assignedTeam || player.team" class="mt-2 text-[9px] font-black text-primary uppercase tracking-tighter bg-primary/5 px-2 py-1 rounded-lg border border-primary/10 text-center truncate w-full">
                {{ player.assignedTeam || player.team }}
              </div>
            </div>

            <!-- Empty slots -->
            <div v-for="i in Math.max(0, 16 - selectedPlayerIds.length)" :key="'empty'+i" class="p-3 border border-dashed border-white/10 rounded-xl text-white/10 text-center flex flex-col items-center justify-center min-h-[100px] opacity-40">
              <span class="text-[20px] mb-1">⏳</span>
              <span class="text-[9px] uppercase font-black tracking-widest">Esperando...</span>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <button @click="generatePots" :disabled="selectedPlayerIds.length < 16" class="btn-primary w-full disabled:opacity-50 flex items-center justify-center gap-2">
              <span>Siguiente: Configurar Bombos</span>
              <span class="text-lg">→</span>
            </button>
            <p v-if="selectedPlayerIds.length < 16" class="text-center text-[10px] text-red-400/60 font-medium uppercase tracking-wider">
              Debes seleccionar exactamente 16 jugadores para continuar
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Step 2: Pots -->
    <section v-if="step === 2" class="animate-fade">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div v-for="(pot, index) in pots" :key="index" class="glass-card">
          <h4 class="text-primary font-bold mb-4">Bombo {{ index + 1 }} (Nivel {{ index + 1 }})</h4>
          <div class="grid grid-cols-2 gap-2">
            <div v-for="player in pot" :key="player.id" class="text-sm p-3 bg-white/5 rounded-lg border border-white/5 flex flex-col">
              <span class="font-bold text-white">{{ player.displayName }}</span>
              <span class="text-[9px] text-primary/60 uppercase font-black">{{ player.assignedTeam || player.team || 'Sin Equipo' }}</span>
            </div>
          </div>
        </div>
      </div>
      <button @click="drawGroups" class="btn-primary w-full">
        Realizar Sorteo de Grupos
      </button>
    </section>

    <!-- Step 3: Groups -->
    <section v-if="step === 3" class="animate-fade">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div v-for="(groupPlayers, groupName) in groups" :key="groupName" class="glass-card border-t-4 border-t-primary">
          <h4 class="text-2xl font-black mb-4">Grupo {{ groupName }}</h4>
          <ul class="space-y-3">
            <li v-for="player in groupPlayers" :key="player.id" class="flex flex-col p-2 bg-white/5 rounded-xl border border-white/5">
              <div class="flex items-center space-x-2">
                <span class="w-2 h-2 rounded-full bg-primary"></span>
                <span class="font-bold">{{ player.displayName }}</span>
                <span class="text-[10px] text-primary font-black uppercase italic ml-1">{{ player.assignedTeam || player.team }}</span>
              </div>
            </li>
          </ul>
        </div>
      </div>
      <div class="flex space-x-4">
        <button @click="step = 2" class="flex-1 py-3 border border-white/10 rounded-xl hover:bg-white/5 transition-all text-xs font-black uppercase tracking-widest text-white/40">
          Repetir Sorteo
        </button>
        <button @click="handleSaveClick" :disabled="loading" class="btn-primary flex-[2]">
          {{ loading ? 'Guardando...' : 'Confirmar y Empezar Torneo' }}
        </button>
      </div>
    </section>

    <!-- Password Modal -->
    <Teleport to="body">
      <div v-if="showPasswordModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
        <div class="glass-card w-full max-w-md border-primary/30 animate-pop">
          <div class="flex justify-between items-start mb-6">
            <div>
              <h3 class="text-2xl font-black text-primary">Confirmar Acción</h3>
              <p class="text-white/40 text-xs uppercase tracking-widest font-bold mt-1">Se requiere autorización</p>
            </div>
            <button @click="showPasswordModal = false" class="text-white/20 hover:text-white transition-colors text-xl">✕</button>
          </div>
          
          <p class="text-sm text-white/60 mb-6">
            Estás a punto de iniciar un nuevo torneo. Esto generará todos los partidos y asignará los equipos de forma permanente.
          </p>

          <div class="space-y-4">
            <div class="space-y-2">
              <label class="text-[10px] font-black uppercase tracking-widest text-primary/60 ml-1">Contraseña de Admin</label>
              <input 
                v-model="tournamentPassword" 
                type="password" 
                placeholder="Introducir contraseña..."
                class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-primary transition-all"
                @keyup.enter="saveTournament"
              >
            </div>

            <button 
              @click="saveTournament" 
              :disabled="loading || !tournamentPassword"
              class="btn-primary w-full py-4 flex items-center justify-center gap-2"
            >
              <span v-if="loading">⏳ Iniciando...</span>
              <span v-else>🚀 DESPLEGAR TORNEO</span>
            </button>
            <button @click="showPasswordModal = false" class="w-full py-2 text-[10px] font-black uppercase tracking-widest text-white/20 hover:text-white/40 transition-all">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </Teleport>


  </main>
</template>
