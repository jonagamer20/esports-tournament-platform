<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { db, auth } from '../../firebase'
import { collection, onSnapshot, getDoc, writeBatch, doc, query, where, getDocs } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'

const players = ref([])
const playoffMatches = ref([])
const loading = ref(true)
const generating = ref(false)
const userRole = ref('player')
let unsubPlayers = null
let unsubMatches = null

const groups = computed(() => {
  const g = { A: [], B: [], C: [], D: [] }
  players.value.forEach(p => {
    if (p.group && g[p.group]) g[p.group].push(p)
  })
  
  Object.keys(g).forEach(key => {
    g[key].sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0)
      const gdA = (a.goalsFor || 0) - (a.goalsAgainst || 0)
      const gdB = (b.goalsFor || 0) - (b.goalsAgainst || 0)
      if (gdB !== gdA) return gdB - gdA
      return (b.goalsFor || 0) - (a.goalsFor || 0)
    })
  })
  return g
})

const matchesByRound = computed(() => {
  const rounds = { Repechaje: [], Cuartos: [], Semis: [], Final: [] }
  playoffMatches.value.forEach(m => {
    if (rounds[m.round]) rounds[m.round].push(m)
  })
  return rounds
})

const repechajeDuels = computed(() => {
  const duels = {}
  playoffMatches.value.forEach(m => {
    if (m.round === 'Repechaje' && m.bracketKey) {
      if (!duels[m.bracketKey]) {
        duels[m.bracketKey] = { id: m.bracketKey, info: m.bracketInfo, ida: null, vuelta: null }
      }
      if (m.type === 'Ida') duels[m.bracketKey].ida = m
      else duels[m.bracketKey].vuelta = m
    }
  })
  return Object.values(duels).sort((a,b) => a.id.localeCompare(b.id))
})

const matchesByKey = computed(() => {
  const keys = {}
  playoffMatches.value.forEach(m => {
    if (m.bracketKey) {
      // We group by key, and ideally take the "Ida" since that's what we show in the bracket
      // or we could show a summary. For the bracket, one card per duel is best.
      if (!keys[m.bracketKey] || m.type === 'Ida') {
        keys[m.bracketKey] = m
      }
    }
  })
  return keys
})

onMounted(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Intentar obtener el rol rápido del documento si ya está cargado o desde firestore
      const userDoc = await getDoc(doc(db, 'users', user.uid))
      if (userDoc.exists()) {
        userRole.value = userDoc.data().role || 'player'
      }
    }
  })

  unsubPlayers = onSnapshot(collection(db, 'users'), (snap) => {
    players.value = snap.docs
      .filter(d => d.data().role === 'player')
      .map(doc => ({ id: doc.id, ...doc.data() }))
    loading.value = false
  })

  const qMatches = query(collection(db, 'matches'), where('phase', '==', 'Final'))
  unsubMatches = onSnapshot(qMatches, (snap) => {
    playoffMatches.value = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  })
})

onUnmounted(() => {
  if (unsubPlayers) unsubPlayers()
  if (unsubMatches) unsubMatches()
})

const generatePlayoffs = async () => {
  if (!confirm("Esto completará la Fase Final (Semis y Final) y habilitará el avance automático sin borrar lo existente. ¿Continuar?")) return
  generating.value = true
  const batch = writeBatch(db)

  try {
    // 1. Assign keys to existing Repechaje/Cuartos if they exist
    const existing = playoffMatches.value
    
    // We define the full bracket structure
    const getBracketConfig = () => [
      // Repechaje
      { id: 'R1', round: 'Repechaje', info: 'R1 (2A vs 3B)', home: groups.value.A[1], away: groups.value.B[2], next: 'Q2', side: 'away' },
      { id: 'R2', round: 'Repechaje', info: 'R2 (2B vs 3A)', home: groups.value.B[1], away: groups.value.A[2], next: 'Q1', side: 'away' },
      { id: 'R3', round: 'Repechaje', info: 'R3 (2C vs 3D)', home: groups.value.C[1], away: groups.value.D[2], next: 'Q4', side: 'away' },
      { id: 'R4', round: 'Repechaje', info: 'R4 (2D vs 3C)', home: groups.value.D[1], away: groups.value.C[2], next: 'Q3', side: 'away' },
      // Cuartos
      { id: 'Q1', round: 'Cuartos', info: 'Cuartos Q1', home: groups.value.A[0], away: null, next: 'S1', side: 'home' },
      { id: 'Q2', round: 'Cuartos', info: 'Cuartos Q2', home: groups.value.B[0], away: null, next: 'S1', side: 'away' },
      { id: 'Q3', round: 'Cuartos', info: 'Cuartos Q3', home: groups.value.C[0], away: null, next: 'S2', side: 'home' },
      { id: 'Q4', round: 'Cuartos', info: 'Cuartos Q4', home: groups.value.D[0], away: null, next: 'S2', side: 'away' },
      // Semis
      { id: 'S1', round: 'Semis', info: 'Semifinal S1', home: null, away: null, next: 'F1', side: 'home' },
      { id: 'S2', round: 'Semis', info: 'Semifinal S2', home: null, away: null, next: 'F1', side: 'away' },
      // Final
      { id: 'F1', round: 'Final', info: 'Gran Final', home: null, away: null, next: null, side: null }
    ]

    const bracketConfig = getBracketConfig()

    bracketConfig.forEach(conf => {
      // Find matches that SHOULD match this config
      const matchingMatches = existing.filter(m => {
        // Match by bracketKey if already exists
        if (m.bracketKey === conf.id) return true
        // Fallback: match by bracketInfo for legacy matches
        if (m.bracketInfo === conf.info) return true
        // Special case for Cuartos which might be Q# or Cuartos Q#
        if (conf.round === 'Cuartos' && m.bracketInfo?.includes(`Q${conf.id.replace('Q','')}`)) return true
        return false
      })

      if (matchingMatches.length > 0) {
        // Update existing matches with advancement metadata
        matchingMatches.forEach(m => {
          batch.update(doc(db, 'matches', m.id), {
            bracketKey: conf.id,
            nextMatchKey: conf.next,
            nextMatchSide: conf.side
          })
        })
      } else {
        // Create NEW matches for this slot
        const common = { 
          phase: 'Final', 
          round: conf.round, 
          bracketInfo: conf.info, 
          bracketKey: conf.id,
          nextMatchKey: conf.next,
          nextMatchSide: conf.side,
          status: 'pending', 
          createdAt: new Date() 
        }
        
        // Ida
        batch.set(doc(collection(db, 'matches')), { 
          ...common, 
          type: 'Ida', 
          homeId: conf.home?.id || 'TBD', 
          awayId: conf.away?.id || 'TBD', 
          homeName: conf.home?.displayName || 'Por Definir', 
          awayName: conf.away?.displayName || 'Por Definir', 
          homeTeam: conf.home?.team || 'TBD', 
          awayTeam: conf.away?.team || 'TBD' 
        })
        
        // Vuelta
        batch.set(doc(collection(db, 'matches')), { 
          ...common, 
          type: 'Vuelta', 
          homeId: conf.away?.id || 'TBD', 
          awayId: conf.home?.id || 'TBD', 
          homeName: conf.away?.displayName || 'Por Definir', 
          awayName: conf.home?.displayName || 'Por Definir', 
          homeTeam: conf.away?.team || 'TBD', 
          awayTeam: conf.home?.team || 'TBD' 
        })
      }
    })

    await batch.commit()

    // 2. Sincronización retroactiva: buscar ganadores en partidos ya terminados con datos frescos
    const freshSnap = await getDocs(query(collection(db, 'matches'), where('phase', '==', 'Final')))
    const allMatches = freshSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    
    const finalBatch = writeBatch(db)
    let promotionsFound = 0

    bracketConfig.forEach(conf => {
      if (!conf.next) return
      
      const currentMatches = allMatches.filter(m => m.bracketKey === conf.id || m.bracketInfo === conf.info)
      const ida = currentMatches.find(m => m.type === 'Ida')
      const vuelta = currentMatches.find(m => m.type === 'Vuelta')
      
      // Soportar tanto 'played' como 'finished'
      const isPlayed = (s) => s === 'played' || s === 'finished'

      if (ida && vuelta && isPlayed(ida.status) && isPlayed(vuelta.status)) {
        const g1 = (ida.scoreHome || 0) + (vuelta.scoreAway || 0)
        const g2 = (ida.scoreAway || 0) + (vuelta.scoreHome || 0)
        
        let winnerId, winnerName, winnerTeam
        if (g1 > g2) {
          winnerId = ida.homeId; winnerName = ida.homeName; winnerTeam = ida.homeTeam || 'TBD'
        } else if (g2 > g1) {
          winnerId = ida.awayId; winnerName = ida.awayName; winnerTeam = ida.awayTeam || 'TBD'
        }
        
        if (winnerId) {
          // Buscar los partidos del siguiente nivel (pueden ser Ida y Vuelta)
          // Buscamos por bracketKey (que acaba de ser actualizado) o bracketInfo
          const nextMatches = allMatches.filter(m => 
            m.bracketKey === conf.next || 
            (conf.next === 'Q1' && m.bracketInfo?.includes('Cuartos Q1')) ||
            (conf.next === 'Q2' && m.bracketInfo?.includes('Cuartos Q2')) ||
            (conf.next === 'Q3' && m.bracketInfo?.includes('Cuartos Q3')) ||
            (conf.next === 'Q4' && m.bracketInfo?.includes('Cuartos Q4')) ||
            (conf.next === 'S1' && m.bracketInfo?.includes('Semifinal S1')) ||
            (conf.next === 'S2' && m.bracketInfo?.includes('Semifinal S2')) ||
            (conf.next === 'F1' && m.bracketInfo?.includes('Gran Final'))
          )

          nextMatches.forEach(nm => {
            const upData = {}
            if (conf.side === 'home') {
              if (nm.type === 'Ida') {
                upData.homeId = winnerId; upData.homeName = winnerName; upData.homeTeam = winnerTeam
              } else {
                upData.awayId = winnerId; upData.awayName = winnerName; upData.awayTeam = winnerTeam
              }
            } else {
              if (nm.type === 'Ida') {
                upData.awayId = winnerId; upData.awayName = winnerName; upData.awayTeam = winnerTeam
              } else {
                upData.homeId = winnerId; upData.homeName = winnerName; upData.homeTeam = winnerTeam
              }
            }
            finalBatch.update(doc(db, 'matches', nm.id), upData)
            promotionsFound++
          })
        }
      }
    })

    if (promotionsFound > 0) {
      await finalBatch.commit()
    }

    alert(promotionsFound > 0 
      ? `¡Fase Final actualizada! Se han avanzado ${Math.ceil(promotionsFound/2)} ganadores a la siguiente ronda.` 
      : "¡Fase Final completada! No se encontraron nuevos resultados para avanzar.");
  } catch (error) {
    console.error(error)
    alert("Error: " + error.message)
  } finally {
    generating.value = false
  }
}

const resetBracket = async () => {
  if (!confirm("⚠️ ¿ESTÁS SEGURO? Esto devolverá todos los partidos del cuadro (Repechaje, Cuartos, etc.) a su estado inicial. Los participantes definidos por la fase de grupos se mantendrán, pero los avanzados se borrarán.")) return
  
  generating.value = true
  try {
    const batch = writeBatch(db)
    const existing = playoffMatches.value
    
    const getBracketConfig = () => [
      { id: 'R1', round: 'Repechaje', info: 'R1 (2A vs 3B)', home: groups.value.A[1], away: groups.value.B[2] },
      { id: 'R2', round: 'Repechaje', info: 'R2 (2B vs 3A)', home: groups.value.B[1], away: groups.value.A[2] },
      { id: 'R3', round: 'Repechaje', info: 'R3 (2C vs 3D)', home: groups.value.C[1], away: groups.value.D[2] },
      { id: 'R4', round: 'Repechaje', info: 'R4 (2D vs 3C)', home: groups.value.D[1], away: groups.value.C[2] },
      { id: 'Q1', round: 'Cuartos', info: 'Cuartos Q1', home: groups.value.A[0], away: null },
      { id: 'Q2', round: 'Cuartos', info: 'Cuartos Q2', home: groups.value.B[0], away: null },
      { id: 'Q3', round: 'Cuartos', info: 'Cuartos Q3', home: groups.value.C[0], away: null },
      { id: 'Q4', round: 'Cuartos', info: 'Cuartos Q4', home: groups.value.D[0], away: null },
      { id: 'S1', round: 'Semis', info: 'Semifinal S1', home: null, away: null },
      { id: 'S2', round: 'Semis', info: 'Semifinal S2', home: null, away: null },
      { id: 'F1', round: 'Final', info: 'Gran Final', home: null, away: null }
    ]

    const bracketConfig = getBracketConfig()

    bracketConfig.forEach(conf => {
      const matchingMatches = existing.filter(m => m.bracketKey === conf.id || m.bracketInfo?.includes(conf.info))
      
      matchingMatches.forEach(m => {
        const resetData = {}
        if (m.type === 'Ida') {
          resetData.homeId = conf.home?.id || 'TBD'
          resetData.awayId = conf.away?.id || 'TBD'
          resetData.homeName = conf.home?.displayName || 'Por Definir'
          resetData.awayName = conf.away?.displayName || 'Por Definir'
          resetData.homeTeam = conf.home?.team || 'TBD'
          resetData.awayTeam = conf.away?.team || 'TBD'
        } else {
          resetData.homeId = conf.away?.id || 'TBD'
          resetData.awayId = conf.home?.id || 'TBD'
          resetData.homeName = conf.away?.displayName || 'Por Definir'
          resetData.awayName = conf.home?.displayName || 'Por Definir'
          resetData.homeTeam = conf.away?.team || 'TBD'
          resetData.awayTeam = conf.home?.team || 'TBD'
        }
        batch.update(doc(db, 'matches', m.id), resetData)
      })
    })

    await batch.commit()
    alert("¡Cuadro reiniciado correctamente!")
  } catch (error) {
    console.error(error)
    alert("Error al reiniciar: " + error.message)
  } finally {
    generating.value = false
  }
}


</script>

<template>
  <main class="p-4 md:p-8">
    <header class="mb-8 flex flex-col md:flex-row justify-between items-center md:items-end gap-6 text-center md:text-left">
      <div>
        <h1 class="text-3xl md:text-4xl font-black gradient-text">Encuentro Final</h1>
        <p class="text-white/40 mt-1">Sigue el camino a la gloria en tiempo real</p>
      </div>
      <div class="flex items-center space-x-4">
        <button v-if="userRole === 'admin'" @click="resetBracket" :disabled="generating || loading" class="px-6 py-4 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 rounded-xl transition-all font-black uppercase tracking-widest text-xs active:scale-95">
          Reiniciar Cuadro
        </button>
        <button v-if="userRole === 'admin'" @click="generatePlayoffs" :disabled="generating || loading" class="btn-primary px-8 py-4 flex items-center space-x-3 active:scale-95 transition-all w-full md:w-auto">
          <span>🏆</span>
          <span class="font-black uppercase tracking-widest text-sm">{{ generating ? 'Generando...' : 'Generar Llaves' }}</span>
        </button>
      </div>
    </header>

    <div v-if="loading" class="flex items-center justify-center p-20"><div class="w-10 h-10 border-4 border-primary border-t-transparent animate-spin rounded-full"></div></div>
    
    <div v-else class="space-y-12">
      <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div v-for="(players, groupName) in groups" :key="groupName" class="glass-card border-t-4 border-t-primary/30">
          <h3 class="text-xl font-black mb-4 flex items-center justify-between"><span>Grupo {{ groupName }}</span><span class="text-[8px] text-primary bg-primary/10 px-2 py-1 rounded">Top 3</span></h3>
          <div class="space-y-2">
            <div v-for="(p, idx) in players.slice(0, 3)" :key="p.id" class="flex items-center space-x-3 p-3 bg-white/5 rounded-xl border border-white/5">
              <span class="text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center" :class="idx === 0 ? 'bg-primary text-secondary' : 'bg-white/10 text-white/40'">{{ idx + 1 }}</span>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-bold truncate">{{ p.displayName }}</p>
                <p class="text-[8px] font-black uppercase text-primary/60 truncate">{{ p.team || 'Sin Equipo' }}</p>
              </div>
              <p class="text-[10px] font-black">{{ p.points || 0 }} pts</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Symmetric Bracket Section -->
      <section v-if="playoffMatches.length > 0" class="relative overflow-x-auto pt-10 pb-20 no-scrollbar">
        <div class="min-w-[1200px] flex justify-between items-center px-4 relative">
          
          <!-- LEFT SIDE: Q1, Q2 -->
          <div class="flex flex-col space-y-32 z-10">
            <!-- Q1 -->
            <div class="bracket-node-wrapper">
              <div v-if="matchesByKey.Q1" class="bracket-card group">
                <div class="bracket-round-label">Cuartos Q1</div>
                <div class="space-y-1.5">
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.Q1.type }}</span>
                    <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.Q1.status === 'played' || matchesByKey.Q1.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                      {{ matchesByKey.Q1.status === 'played' || matchesByKey.Q1.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q1.homeName ? matchesByKey.Q1.homeName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q1.homeName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q1.scoreHome ?? '-' }}</span>
                    </div>
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q1.awayName ? matchesByKey.Q1.awayName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q1.awayName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q1.scoreAway ?? '-' }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Connection to S1 -->
              <div class="connector-line left-to-right h-px w-20 bg-primary/20 absolute -right-20 top-1/2"></div>
            </div>

            <!-- Q2 -->
            <div class="bracket-node-wrapper">
              <div v-if="matchesByKey.Q2" class="bracket-card group">
                <div class="bracket-round-label">Cuartos Q2</div>
                <div class="space-y-1.5">
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.Q2.type }}</span>
                    <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.Q2.status === 'played' || matchesByKey.Q2.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                      {{ matchesByKey.Q2.status === 'played' || matchesByKey.Q2.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q2.homeName ? matchesByKey.Q2.homeName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q2.homeName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q2.scoreHome ?? '-' }}</span>
                    </div>
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q2.awayName ? matchesByKey.Q2.awayName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q2.awayName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q2.scoreAway ?? '-' }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="connector-line left-to-right h-px w-20 bg-primary/20 absolute -right-20 top-1/2"></div>
            </div>
            
            <!-- Vertical Line for S1 -->
            <div class="absolute -right-20 top-[60px] bottom-[60px] w-px bg-primary/20"></div>
            <div class="absolute -right-20 top-1/2 -translate-y-1/2 w-8 h-px bg-primary/20"></div>
          </div>

          <!-- MID LEFT: S1 -->
          <div class="flex flex-col z-10">
            <div v-if="matchesByKey.S1" class="bracket-card group">
              <div class="bracket-round-label">Semifinal S1</div>
              <div class="space-y-1.5">
                <div class="flex justify-between items-center mb-1">
                  <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.S1.type }}</span>
                  <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.S1.status === 'played' || matchesByKey.S1.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                    {{ matchesByKey.S1.status === 'played' || matchesByKey.S1.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                  </span>
                </div>
                <div class="space-y-1">
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.S1.homeName ? matchesByKey.S1.homeName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.S1.homeName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.S1.scoreHome ?? '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.S1.awayName ? matchesByKey.S1.awayName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.S1.awayName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.S1.scoreAway ?? '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="connector-line left-to-right h-px w-20 bg-primary/20 absolute -right-20 top-1/2"></div>
          </div>

          <!-- CENTER: TROPHY & FINAL -->
          <div class="flex flex-col items-center space-y-8 z-20">
            <div class="relative w-64 h-64 flex items-center justify-center">
              <div class="absolute inset-0 bg-primary/20 blur-[100px] rounded-full animate-pulse"></div>
              <img src="/assets/encebollado.png" alt="Encebollado" class="w-full h-full object-contain drop-shadow-[0_0_50px_rgba(255,193,7,0.5)] scale-125 mix-blend-screen overflow-hidden">
            </div>
            
            <!-- The Grand Final -->
            <div v-if="matchesByKey.F1" class="bracket-card group border-primary/50 bg-primary/5 scale-110 shadow-[0_0_50px_rgba(255,193,7,0.1)]">
              <div class="bracket-round-label !bg-primary !text-secondary">Gran Final</div>
              <div class="space-y-1.5">
                <div class="flex justify-between items-center mb-1">
                  <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.F1.type }}</span>
                  <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.F1.status === 'played' || matchesByKey.F1.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                    {{ matchesByKey.F1.status === 'played' || matchesByKey.F1.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                  </span>
                </div>
                <div class="space-y-1">
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.F1.homeName ? matchesByKey.F1.homeName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.F1.homeName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.F1.scoreHome ?? '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.F1.awayName ? matchesByKey.F1.awayName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.F1.awayName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.F1.scoreAway ?? '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- MID RIGHT: S2 -->
          <div class="flex flex-col z-10 relative">
            <div v-if="matchesByKey.S2" class="bracket-card group">
              <div class="bracket-round-label">Semifinal S2</div>
              <div class="space-y-1.5">
                <div class="flex justify-between items-center mb-1">
                  <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.S2.type }}</span>
                  <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.S2.status === 'played' || matchesByKey.S2.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                    {{ matchesByKey.S2.status === 'played' || matchesByKey.S2.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                  </span>
                </div>
                <div class="space-y-1">
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.S2.homeName ? matchesByKey.S2.homeName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.S2.homeName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.S2.scoreHome ?? '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                    <div class="flex items-center space-x-2 flex-1 min-w-0">
                      <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.S2.awayName ? matchesByKey.S2.awayName[0] : '?' }}</div>
                      <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.S2.awayName || 'Por Definir' }}</span>
                    </div>
                    <span class="text-xs font-black text-primary">{{ matchesByKey.S2.scoreAway ?? '-' }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="connector-line right-to-left h-px w-20 bg-primary/20 absolute -left-20 top-1/2"></div>
          </div>

          <!-- RIGHT SIDE: Q3, Q4 -->
          <div class="flex flex-col space-y-32 z-10 relative">
            <!-- Q3 -->
            <div class="bracket-node-wrapper">
              <div v-if="matchesByKey.Q3" class="bracket-card group">
                <div class="bracket-round-label">Cuartos Q3</div>
                <div class="space-y-1.5">
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.Q3.type }}</span>
                    <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.Q3.status === 'played' || matchesByKey.Q3.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                      {{ matchesByKey.Q3.status === 'played' || matchesByKey.Q3.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q3.homeName ? matchesByKey.Q3.homeName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q3.homeName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q3.scoreHome ?? '-' }}</span>
                    </div>
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q3.awayName ? matchesByKey.Q3.awayName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q3.awayName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q3.scoreAway ?? '-' }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="connector-line right-to-left h-px w-20 bg-primary/20 absolute -left-20 top-1/2"></div>
            </div>

            <!-- Q4 -->
            <div class="bracket-node-wrapper">
              <div v-if="matchesByKey.Q4" class="bracket-card group">
                <div class="bracket-round-label">Cuartos Q4</div>
                <div class="space-y-1.5">
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-[7px] font-black uppercase tracking-widest text-white/20">{{ matchesByKey.Q4.type }}</span>
                    <span class="text-[7px] font-black uppercase px-2 py-0.5 rounded" :class="matchesByKey.Q4.status === 'played' || matchesByKey.Q4.status === 'finished' ? 'bg-green-500/10 text-green-400' : 'bg-primary/10 text-primary'">
                      {{ matchesByKey.Q4.status === 'played' || matchesByKey.Q4.status === 'finished' ? 'Finalizado' : 'Pendiente' }}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q4.homeName ? matchesByKey.Q4.homeName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q4.homeName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q4.scoreHome ?? '-' }}</span>
                    </div>
                    <div class="flex items-center justify-between bg-white/[0.02] rounded-lg p-2 border border-white/5">
                      <div class="flex items-center space-x-2 flex-1 min-w-0">
                        <div class="w-4 h-4 bg-white/5 rounded flex items-center justify-center text-[7px] font-black text-primary">{{ matchesByKey.Q4.awayName ? matchesByKey.Q4.awayName[0] : '?' }}</div>
                        <span class="text-[10px] font-bold truncate tracking-tight text-white">{{ matchesByKey.Q4.awayName || 'Por Definir' }}</span>
                      </div>
                      <span class="text-xs font-black text-primary">{{ matchesByKey.Q4.scoreAway ?? '-' }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="connector-line right-to-left h-px w-20 bg-primary/20 absolute -left-20 top-1/2"></div>
            </div>

            <!-- Vertical Line for S2 -->
            <div class="absolute -left-20 top-[60px] bottom-[60px] w-px bg-primary/20"></div>
            <div class="absolute -left-20 top-1/2 -translate-y-1/2 w-8 h-px bg-primary/20"></div>
          </div>

        </div>

        <!-- Repechaje Section - Grouped by Series -->
        <div v-if="repechajeDuels.length > 0" class="mt-32 px-4 max-w-7xl mx-auto">
          <h4 class="text-xs font-black uppercase text-white/20 tracking-[0.3em] mb-12 flex items-center space-x-4">
            <span>Ronda de Repechaje</span>
            <span class="h-px flex-1 bg-white/5"></span>
          </h4>
          
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div v-for="duel in repechajeDuels" :key="duel.id" class="glass-card !p-0 overflow-hidden border-white/5 hover:border-primary/20 transition-all group">
              <!-- Header -->
              <div class="bg-white/[0.03] p-4 border-b border-white/5 flex justify-between items-center">
                <span class="text-[10px] font-black uppercase tracking-widest text-primary">{{ duel.info || duel.id }}</span>
                <div class="flex space-x-2">
                  <span v-if="duel.ida?.status === 'played' || duel.ida?.status === 'finished'" class="text-[8px] font-black bg-green-500/10 text-green-400 px-2 py-0.5 rounded uppercase">Ida OK</span>
                  <span v-if="duel.vuelta?.status === 'played' || duel.vuelta?.status === 'finished'" class="text-[8px] font-black bg-green-500/10 text-green-400 px-2 py-0.5 rounded uppercase">Vuelta OK</span>
                </div>
              </div>

              <!-- Match Content -->
              <div class="p-6 flex items-center justify-between gap-4">
                <!-- Player 1 -->
                <div class="flex-1 text-center space-y-2">
                  <div class="w-12 h-12 bg-primary/10 rounded-2xl mx-auto flex items-center justify-center text-xl border border-primary/20 shadow-lg shadow-primary/5">
                    {{ duel.ida?.homeName?.[0] || '?' }}
                  </div>
                  <div class="font-black text-sm text-white truncate px-2">{{ duel.ida?.homeName || 'TBD' }}</div>
                  <div class="text-[9px] text-primary/60 font-black uppercase italic">{{ duel.ida?.homeTeam || 'TBD' }}</div>
                </div>

                <!-- Scores Core -->
                <div class="flex flex-col items-center space-y-4 px-4 bg-white/[0.02] py-4 rounded-3xl border border-white/5">
                  <div class="flex items-center space-x-6">
                    <!-- Ida -->
                    <div class="text-center">
                      <div class="text-[8px] font-black text-white/20 uppercase mb-1">Ida</div>
                      <div class="text-lg font-black text-white">{{ duel.ida?.scoreHome ?? '-' }} : {{ duel.ida?.scoreAway ?? '-' }}</div>
                    </div>
                    <!-- Vuelta -->
                    <div class="text-center">
                      <div class="text-[8px] font-black text-white/20 uppercase mb-1">Vuelta</div>
                      <div class="text-lg font-black text-white">{{ duel.vuelta?.scoreHome ?? '-' }} : {{ duel.vuelta?.scoreAway ?? '-' }}</div>
                    </div>
                  </div>
                  
                  <!-- Global Result -->
                  <div class="pt-3 border-t border-white/5 w-full text-center">
                    <div class="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-1">Marcador Global</div>
                    <div class="text-3xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">
                      {{ (duel.ida?.scoreHome || 0) + (duel.vuelta?.scoreAway || 0) }} 
                      <span class="text-primary/40 mx-2 text-xl">-</span> 
                      {{ (duel.ida?.scoreAway || 0) + (duel.vuelta?.scoreHome || 0) }}
                    </div>
                  </div>
                </div>

                <!-- Player 2 -->
                <div class="flex-1 text-center space-y-2">
                  <div class="w-12 h-12 bg-white/5 rounded-2xl mx-auto flex items-center justify-center text-xl border border-white/10">
                    {{ duel.ida?.awayName?.[0] || '?' }}
                  </div>
                  <div class="font-black text-sm text-white truncate px-2">{{ duel.ida?.awayName || 'TBD' }}</div>
                  <div class="text-[9px] text-white/20 font-black uppercase italic">{{ duel.ida?.awayTeam || 'TBD' }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      <div v-else class="text-center py-20 glass-card bg-white/[0.02] border-dashed border-2">
        <span class="text-4xl mb-4 block">⏳</span>
        <h4 class="text-xl font-black text-white/40">Fase Final en camino</h4>
        <p class="text-sm text-white/20 mt-2">Los mejores equipos están terminando la fase de grupos.</p>
      </div>
    </div>
  </main>
</template>

<!-- Small sub-component for Match Nodes would ideally be here or as a separate file -->


<style scoped>
@reference "../../style.css";

.bracket-card {
  @apply bg-[#000]/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 w-[220px] transition-all duration-500 relative shadow-2xl;
}
.bracket-card:hover {
  @apply border-primary/40 -translate-y-1;
}
.bracket-round-label {
  @apply absolute -top-3 left-4 bg-primary text-secondary text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-white/20 shadow-lg z-30;
}
.bracket-node-wrapper {
  @apply relative;
}

.btn-primary {
  @apply bg-primary text-secondary rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50;
}
.glass-card {
  @apply bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-3xl p-6;
}
.gradient-text {
  @apply bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent;
}
.animate-fade {
  animation: fadeIn 0.5s ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Custom Scrollbar for the bracket */
.no-scrollbar::-webkit-scrollbar {
  height: 4px;
}
.no-scrollbar::-webkit-scrollbar-track {
  background: rgba(255,255,255,0.02);
}
.no-scrollbar::-webkit-scrollbar-thumb {
  background: var(--primary-color, #ffc107);
  border-radius: 10px;
}
</style>
