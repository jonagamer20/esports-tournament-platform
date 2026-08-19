<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { db } from '../../firebase'
import { collection, onSnapshot, doc, updateDoc, increment, writeBatch, getDocs, query, limit } from 'firebase/firestore'

const groups = ref({ A: [], B: [], C: [], D: [] })
const loading = ref(true)
const generating = ref(false)
let unsubscribe = null

onMounted(() => {
  const q = collection(db, 'users')
  unsubscribe = onSnapshot(q, (querySnapshot) => {
    const players = querySnapshot.docs.filter(d => d.data().role === 'player').map(doc => ({ id: doc.id, ...doc.data() }))
    
    // Sort players by points, then goal difference, then goals for
    players.sort((a, b) => {
      if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0)
      const gdA = (a.goalsFor || 0) - (a.goalsAgainst || 0)
      const gdB = (b.goalsFor || 0) - (b.goalsAgainst || 0)
      if (gdB !== gdA) return gdB - gdA
      return (b.goalsFor || 0) - (a.goalsFor || 0)
    })
    
    const tempGroups = { A: [], B: [], C: [], D: [] }
    players.forEach(p => {
      if (p.group && tempGroups[p.group]) {
        tempGroups[p.group].push(p)
      }
    })
    groups.value = tempGroups
    loading.value = false
  }, (error) => {
    console.error("Error listening to groups:", error)
    loading.value = false
  })
})

const startTournament = async () => {
  // Check if matches already exist
  const matchesSnapshot = await getDocs(query(collection(db, 'matches'), limit(1)))
  if (!matchesSnapshot.empty) {
    if (!confirm('Ya existen partidos generados. ¿Deseas borrarlos y generar el calendario de nuevo?')) {
      return
    }
    // Delete existing matches (simplified for this task, usually you'd batch delete)
    const allMatches = await getDocs(collection(db, 'matches'))
    const deleteBatch = writeBatch(db)
    allMatches.docs.forEach(d => deleteBatch.delete(d.ref))
    await deleteBatch.commit()
  }

  generating.value = true
  try {
    const batch = writeBatch(db)
    
    // Berger Table for 4 players
    const schedule = [
      [[0, 3], [1, 2]], // Fecha 1
      [[3, 2], [0, 1]], // Fecha 2
      [[1, 3], [2, 0]]  // Fecha 3
    ]

    Object.entries(groups.value).forEach(([groupName, groupPlayers]) => {
      if (groupPlayers.length !== 4) return

      schedule.forEach((fechaMatches, index) => {
        const fechaNum = index + 1
        
        fechaMatches.forEach(([homeIdx, awayIdx]) => {
          const pHome = groupPlayers[homeIdx]
          const pAway = groupPlayers[awayIdx]

          // Ida
          const matchIdaRef = doc(collection(db, 'matches'))
          batch.set(matchIdaRef, {
            homeId: pHome.id,
            awayId: pAway.id,
            homeName: pHome.displayName,
            awayName: pAway.displayName,
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

          // Vuelta (Same Fecha as Ida)
          const matchVueltaRef = doc(collection(db, 'matches'))
          batch.set(matchVueltaRef, {
            homeId: pAway.id,
            awayId: pHome.id,
            homeName: pAway.displayName,
            awayName: pHome.displayName,
            group: groupName,
            fecha: fechaNum,
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
    alert('¡Torneo iniciado! 3 fechas generadas (Ida y Vuelta el mismo día).')
  } catch (error) {
    console.error(error)
    alert('Error al generar partidos')
  } finally {
    generating.value = false
  }
}

const calculatePoints = (homeScore, awayScore) => {
  if (homeScore > awayScore) return { home: 3, away: 0 }
  if (homeScore < awayScore) return { home: 0, away: 3 }
  return { home: 1, away: 1 }
}

const recalculateStats = async () => {
  if (!confirm('¿Deseas recalcular todas las estadísticas desde cero? Esto limpiará la tabla y volverá a contar los puntos de cada partido finalizado.')) return
  
  generating.value = true
  try {
    const batch = writeBatch(db)
    
    // 1. Get all players and reset stats
    const playersSnapshot = await getDocs(collection(db, 'users'))
    const playerIds = []
    playersSnapshot.docs.forEach(d => {
      const data = d.data()
      if (data.role === 'player') {
        playerIds.push(d.id)
        batch.update(d.ref, {
          points: 0,
          playedMatches: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0
        })
      }
    })

    // 2. Get all played matches (Only Group Stage, NOT phase 'Final')
    const matchesSnapshot = await getDocs(collection(db, 'matches'))
    const playedMatches = matchesSnapshot.docs.filter(d => {
      const data = d.data()
      return data.status === 'played' && data.phase !== 'Final'
    })
    
    const stats = {}
    playerIds.forEach(id => {
      stats[id] = { points: 0, playedMatches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
    })

    playedMatches.forEach(d => {
      const m = d.data()
      const pts = calculatePoints(m.scoreHome, m.scoreAway)
      
      if (stats[m.homeId]) {
        stats[m.homeId].points += pts.home
        stats[m.homeId].playedMatches += 1
        stats[m.homeId].wins += (pts.home === 3 ? 1 : 0)
        stats[m.homeId].draws += (pts.home === 1 ? 1 : 0)
        stats[m.homeId].losses += (pts.home === 0 ? 1 : 0)
        stats[m.homeId].goalsFor += m.scoreHome
        stats[m.homeId].goalsAgainst += m.scoreAway
      }

      if (stats[m.awayId]) {
        stats[m.awayId].points += pts.away
        stats[m.awayId].playedMatches += 1
        stats[m.awayId].wins += (pts.away === 3 ? 1 : 0)
        stats[m.awayId].draws += (pts.away === 1 ? 1 : 0)
        stats[m.awayId].losses += (pts.away === 0 ? 1 : 0)
        stats[m.awayId].goalsFor += m.scoreAway
        stats[m.awayId].goalsAgainst += m.scoreHome
      }
    })

    // 3. Apply consolidated stats
    Object.keys(stats).forEach(id => {
      const s = stats[id]
      batch.update(doc(db, 'users', id), s)
    })

    await batch.commit()
    alert('¡Estadísticas recalculadas con éxito!')
  } catch (error) {
    console.error(error)
    alert('Error al recalcular: ' + error.message)
  } finally {
    generating.value = false
  }
}

const addPoints = async (playerId, pts) => {
  try {
    await updateDoc(doc(db, 'users', playerId), {
      points: increment(pts)
    })
  } catch (error) {
    console.error(error)
  }
}

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-8">
    <header class="mb-12 flex justify-between items-start">
      <div>
        <h1 class="text-4xl font-black gradient-text">Gestión de Grupos</h1>
        <p class="text-white/40 mt-1">Actualiza resultados y puntos de la fase de grupos</p>
      </div>
      <div class="flex space-x-3">
        <button 
          @click="recalculateStats" 
          :disabled="generating"
          class="px-6 py-3 bg-white/5 text-white/40 border border-white/10 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all disabled:opacity-50"
        >
          🔄 Recalcular
        </button>
        <button 
          @click="startTournament" 
          :disabled="generating"
          class="btn-primary px-8 py-3 flex items-center space-x-2"
        >
          <span>{{ generating ? 'Generando...' : '🚀 Empezar Torneo' }}</span>
        </button>
      </div>
    </header>

    <div v-if="loading" class="text-center p-12 text-white/40">Cargando...</div>

    <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-8">
      <div v-for="(players, groupName) in groups" :key="groupName" class="glass-card overflow-hidden">
        <div class="flex justify-between items-center mb-6 px-2">
          <h3 class="text-2xl font-black">Grupo {{ groupName }}</h3>
          <span class="text-[10px] bg-white/5 text-white/40 px-2 py-1 rounded font-black border border-white/10 uppercase">Administración</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="text-[10px] text-white/20 uppercase font-black border-b border-white/5">
                <th class="pb-3 pl-2">#</th>
                <th class="pb-3">Jugador</th>
                <th class="pb-3 text-center">PJ</th>
                <th class="pb-3 text-center text-primary">DG</th>
                <th class="pb-3 text-center font-black text-white">Pts</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5">
              <tr v-for="(player, index) in players" :key="player.id" class="group hover:bg-white/[0.02] transition-colors">
                <td class="py-4 pl-2 text-[10px] font-black text-white/20">{{ index + 1 }}</td>
                <td class="py-4">
                  <div class="flex items-center space-x-3">
                    <div class="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-[10px] border border-white/10">👤</div>
                    <div class="flex flex-col">
                      <span class="font-bold text-sm text-white">{{ player.displayName }}</span>
                      <span class="text-[9px] text-primary font-black uppercase italic">{{ player.team }}</span>
                    </div>
                  </div>
                </td>
                <td class="py-4 text-center text-xs font-bold text-white/60">{{ player.playedMatches || 0 }}</td>
                <td class="py-4 text-center text-xs font-black" :class="(player.goalsFor || 0) - (player.goalsAgainst || 0) >= 0 ? 'text-green-400' : 'text-red-400'">
                  {{ (player.goalsFor || 0) - (player.goalsAgainst || 0) > 0 ? '+' : '' }}{{ (player.goalsFor || 0) - (player.goalsAgainst || 0) }}
                </td>
                <td class="py-4 text-center font-black text-white">{{ player.points || 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </main>
</template>
