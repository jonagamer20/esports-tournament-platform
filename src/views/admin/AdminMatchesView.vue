<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { db } from '../../firebase'
import { collection, onSnapshot, query, orderBy, doc, writeBatch, increment, updateDoc, deleteField, getDocs, where } from 'firebase/firestore'

const matches = ref([])
const loading = ref(true)
let unsubscribe = null

onMounted(() => {
  const q = query(collection(db, 'matches'))
  unsubscribe = onSnapshot(q, (snapshot) => {
    matches.value = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    loading.value = false
  })
})

const filterStatus = ref('all') // all, awaiting_approval, played, pending
const filterFecha = ref('all') // all, 1, 2, 3...
const showWOModal = ref(false)
const woMatch = ref(null)
const isSubmitting = ref(false)

const availableFechas = computed(() => {
  const f = new Set(matches.value.filter(m => m.fecha).map(m => m.fecha > 3 ? m.fecha - 3 : m.fecha))
  return Array.from(f).sort((a, b) => a - b)
})

const calculatePoints = (homeScore, awayScore) => {
  if (homeScore > awayScore) return { home: 3, away: 0 }
  if (homeScore < awayScore) return { home: 0, away: 3 }
  return { home: 1, away: 1 }
}

const checkAndPromotePlayoffWinner = async (batch, match, scores) => {
  if (!match.ida?.nextMatchKey) return

  const g1 = (scores.idaHome || 0) + (scores.vueltaAway || 0)
  const g2 = (scores.idaAway || 0) + (scores.vueltaHome || 0)
  
  let winnerId, winnerName, winnerTeam
  if (g1 > g2) {
    winnerId = match.ida.homeId
    winnerName = match.ida.homeName
    winnerTeam = match.ida.homeTeam || 'TBD'
  } else if (g2 > g1) {
    winnerId = match.ida.awayId
    winnerName = match.ida.awayName
    winnerTeam = match.ida.awayTeam || 'TBD'
  } else {
    // En caso de empate global, no avanzamos automáticamente
    console.log('Empate global, el admin debe decidir o hubo penales')
    return
  }

  if (winnerId) {
    const qNext = query(collection(db, 'matches'), 
      where('phase', '==', 'Final'),
      where('bracketKey', '==', match.ida.nextMatchKey)
    )
    const nextSnap = await getDocs(qNext)
    nextSnap.docs.forEach(d => {
      const nextData = d.data()
      const updateData = {}
      if (match.ida.nextMatchSide === 'home') {
        if (nextData.type === 'Ida') {
          updateData.homeId = winnerId; updateData.homeName = winnerName; updateData.homeTeam = winnerTeam
        } else {
          updateData.awayId = winnerId; updateData.awayName = winnerName; updateData.awayTeam = winnerTeam
        }
      } else {
        if (nextData.type === 'Ida') {
          updateData.awayId = winnerId; updateData.awayName = winnerName; updateData.awayTeam = winnerTeam
        } else {
          updateData.homeId = winnerId; updateData.homeName = winnerName; updateData.homeTeam = winnerTeam
        }
      }
      batch.update(d.ref, updateData)
    })
  }
}

const openWOModal = (match) => {
  woMatch.value = match
  showWOModal.value = true
}

const handleWalkOver = async (winnerId) => {
  if (!confirm('¿Confirmar WO (Walk Over)? Se darán 6 puntos al ganador (3-0 en ambos partidos).')) return
  
  isSubmitting.value = true
  try {
    const batch = writeBatch(db)
    const playerStats = {}

    const processWO = (m, winnerId) => {
      if (!m) return
      
      const isHomeWinner = m.homeId === winnerId
      const scoreHome = isHomeWinner ? 3 : 0
      const scoreAway = isHomeWinner ? 0 : 3
      const pts = calculatePoints(scoreHome, scoreAway)

      // Update Match with WO result
      batch.update(doc(db, 'matches', m.id), {
        scoreHome,
        scoreAway,
        status: 'played',
        isWalkOver: true,
        reportedAt: new Date(),
        reportedBy: 'admin'
      })

      // Accumulate Home Stats
      if (!playerStats[m.homeId]) playerStats[m.homeId] = { points: 0, playedMatches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
      playerStats[m.homeId].points += pts.home
      playerStats[m.homeId].playedMatches += 1
      playerStats[m.homeId].wins += (pts.home === 3 ? 1 : 0)
      playerStats[m.homeId].losses += (pts.home === 0 ? 1 : 0)
      playerStats[m.homeId].goalsFor += scoreHome
      playerStats[m.homeId].goalsAgainst += scoreAway

      // Accumulate Away Stats
      if (!playerStats[m.awayId]) playerStats[m.awayId] = { points: 0, playedMatches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }
      playerStats[m.awayId].points += pts.away
      playerStats[m.awayId].playedMatches += 1
      playerStats[m.awayId].wins += (pts.away === 3 ? 1 : 0)
      playerStats[m.awayId].losses += (pts.away === 0 ? 1 : 0)
      playerStats[m.awayId].goalsFor += scoreAway
      playerStats[m.awayId].goalsAgainst += scoreHome
    }

    processWO(woMatch.value.ida, winnerId)
    processWO(woMatch.value.vuelta, winnerId)

    // Advancement logic for Playoffs in WO
    const isP1Winner = woMatch.value.ida.homeId === winnerId
    await checkAndPromotePlayoffWinner(batch, woMatch.value, {
      idaHome: isP1Winner ? 3 : 0,
      idaAway: isP1Winner ? 0 : 3,
      vueltaHome: isP1Winner ? 0 : 3,
      vueltaAway: isP1Winner ? 3 : 0
    })

    // Only update cumulative stats if NOT a playoff match
    if (woMatch.value.ida.phase !== 'Final') {
      Object.keys(playerStats).forEach(playerId => {
        const s = playerStats[playerId]
        batch.update(doc(db, 'users', playerId), {
          points: increment(s.points),
          playedMatches: increment(s.playedMatches),
          wins: increment(s.wins),
          draws: increment(s.draws),
          losses: increment(s.losses),
          goalsFor: increment(s.goalsFor),
          goalsAgainst: increment(s.goalsAgainst)
        })
      })
    }

    await batch.commit()
    alert('WO registrado. 6 puntos otorgados al ganador.')
    showWOModal.value = false
  } catch (error) {
    console.error(error)
    alert('Error al registrar WO: ' + error.message)
  } finally {
    isSubmitting.value = false
  }
}

const approveResults = async (match) => {
  if (!confirm('¿Aprobar resultados? Se actualizarán los puntos en la tabla.')) return

  isSubmitting.value = true
  try {
    const batch = writeBatch(db)
    
    // Calculate points for Ida
    const ptsIda = calculatePoints(match.ida.scoreHome, match.ida.scoreAway)
    
    // Calculate points for Vuelta
    const ptsVuelta = calculatePoints(match.vuelta.scoreHome, match.vuelta.scoreAway)
    
    // Update Both Match Documents Status
    const now = new Date()
    if (match.ida?.id) {
      batch.update(doc(db, 'matches', match.ida.id), {
        status: 'played',
        reportedAt: match.reportedAt || now
      })
    }
    if (match.vuelta?.id) {
      batch.update(doc(db, 'matches', match.vuelta.id), {
        status: 'played',
        reportedAt: match.reportedAt || now
      })
    }
    
    // Players mapping based on IDA match
    const p1Id = match.ida.homeId
    const p2Id = match.ida.awayId
    
    // Update Player Stats ONLY if it's NOT a playoff match
    if (match.ida.phase !== 'Final') {
      // Update Player 1 Stats (Home in Ida, Away in Vuelta)
      const p1Stats = {
        points: ptsIda.home + ptsVuelta.away,
        playedMatches: 2,
        wins: (ptsIda.home === 3 ? 1 : 0) + (ptsVuelta.away === 3 ? 1 : 0),
        draws: (ptsIda.home === 1 ? 1 : 0) + (ptsVuelta.away === 1 ? 1 : 0),
        losses: (ptsIda.home === 0 ? 1 : 0) + (ptsVuelta.away === 0 ? 1 : 0),
        goalsFor: match.ida.scoreHome + match.vuelta.scoreAway,
        goalsAgainst: match.ida.scoreAway + match.vuelta.scoreHome
      }
      
      batch.update(doc(db, 'users', p1Id), {
        points: increment(p1Stats.points),
        playedMatches: increment(p1Stats.playedMatches),
        wins: increment(p1Stats.wins),
        draws: increment(p1Stats.draws),
        losses: increment(p1Stats.losses),
        goalsFor: increment(p1Stats.goalsFor),
        goalsAgainst: increment(p1Stats.goalsAgainst)
      })
      
      // Update Player 2 Stats (Away in Ida, Home in Vuelta)
      const p2Stats = {
        points: ptsIda.away + ptsVuelta.home,
        playedMatches: 2,
        wins: (ptsIda.away === 3 ? 1 : 0) + (ptsVuelta.home === 3 ? 1 : 0),
        draws: (ptsIda.away === 1 ? 1 : 0) + (ptsVuelta.home === 1 ? 1 : 0),
        losses: (ptsIda.away === 0 ? 1 : 0) + (ptsVuelta.home === 0 ? 1 : 0),
        goalsFor: match.ida.scoreAway + match.vuelta.scoreHome,
        goalsAgainst: match.ida.scoreHome + match.vuelta.scoreAway
      }
      
      batch.update(doc(db, 'users', p2Id), {
        points: increment(p2Stats.points),
        playedMatches: increment(p2Stats.playedMatches),
        wins: increment(p2Stats.wins),
        draws: increment(p2Stats.draws),
        losses: increment(p2Stats.losses),
        goalsFor: increment(p2Stats.goalsFor),
        goalsAgainst: increment(p2Stats.goalsAgainst)
      })
    }

    // Advancement logic for Playoffs
    await checkAndPromotePlayoffWinner(batch, match, {
      idaHome: match.ida.scoreHome,
      idaAway: match.ida.scoreAway,
      vueltaHome: match.vuelta.scoreHome,
      vueltaAway: match.vuelta.scoreAway
    })
    
    await batch.commit()
    alert('Resultados aprobados y puntos actualizados.')
  } catch (error) {
    console.error(error)
    alert('Error al aprobar: ' + error.message)
  } finally {
    isSubmitting.value = false
  }
}

const rejectResults = async (match) => {
  if (!confirm('¿Rechazar resultados? Se pedirá a los jugadores que los ingresen nuevamente.')) return

  isSubmitting.value = true
  try {
    const batch = writeBatch(db)
    const resetData = {
      status: 'scheduled',
      scoreHome: deleteField(),
      scoreAway: deleteField(),
      evidenceUrl: deleteField(),
      reportedAt: deleteField(),
      reportedBy: deleteField()
    }
    // Reset both matches to scheduled so they can submit again
    if (match.ida?.id) batch.update(doc(db, 'matches', match.ida.id), resetData)
    if (match.vuelta?.id) batch.update(doc(db, 'matches', match.vuelta.id), resetData)
    
    await batch.commit()
    alert('Resultados rechazados.')
  } catch (error) {
    console.error(error)
    alert('Error al rechazar: ' + error.message)
  } finally {
    isSubmitting.value = false
  }
}

const showEditModal = ref(false)
const editingMatch = ref(null)
const editForm = ref({
  idaHome: 0, idaAway: 0,
  vueltaHome: 0, vueltaAway: 0
})

const startEditing = (match) => {
  editingMatch.value = match
  editForm.value = {
    idaHome: match.ida?.scoreHome || 0,
    idaAway: match.ida?.scoreAway || 0,
    vueltaHome: match.vuelta?.scoreHome || 0,
    vueltaAway: match.vuelta?.scoreAway || 0
  }
  showEditModal.value = true
}

const saveEdit = async () => {
  if (!editingMatch.value) return
  
  isSubmitting.value = true
  try {
    const oldMatch = editingMatch.value
    const batch = writeBatch(db)
    
    // Players mapping based on IDA match
    const p1Id = oldMatch.ida.homeId
    const p2Id = oldMatch.ida.awayId

    // 2. Apply New Stats
    const newIdaHome = editForm.value.idaHome
    const newIdaAway = editForm.value.idaAway
    const newVueltaHome = editForm.value.vueltaHome
    const newVueltaAway = editForm.value.vueltaAway

    // Update Player Stats ONLY if it's NOT a playoff match
    if (oldMatch.ida?.phase !== 'Final') {
      // 1. Revert Old Stats (Only if the match was already in 'played' status)
      if (oldMatch.status === 'played') {
        const oldPtsIda = calculatePoints(oldMatch.ida.scoreHome, oldMatch.ida.scoreAway)
        const oldPtsVuelta = calculatePoints(oldMatch.vuelta.scoreHome, oldMatch.vuelta.scoreAway)
        
        const revertP1 = {
          points: -(oldPtsIda.home + oldPtsVuelta.away),
          playedMatches: -2,
          wins: -((oldPtsIda.home === 3 ? 1 : 0) + (oldPtsVuelta.away === 3 ? 1 : 0)),
          draws: -((oldPtsIda.home === 1 ? 1 : 0) + (oldPtsVuelta.away === 1 ? 1 : 0)),
          losses: -((oldPtsIda.home === 0 ? 1 : 0) + (oldPtsVuelta.away === 0 ? 1 : 0)),
          goalsFor: -(oldMatch.ida.scoreHome + oldMatch.vuelta.scoreAway),
          goalsAgainst: -(oldMatch.ida.scoreAway + oldMatch.vuelta.scoreHome)
        }
        
        const revertP2 = {
          points: -(oldPtsIda.away + oldPtsVuelta.home),
          playedMatches: -2,
          wins: -((oldPtsIda.away === 3 ? 1 : 0) + (oldPtsVuelta.home === 3 ? 1 : 0)),
          draws: -((oldPtsIda.away === 1 ? 1 : 0) + (oldPtsVuelta.home === 1 ? 1 : 0)),
          losses: -((oldPtsIda.away === 0 ? 1 : 0) + (oldPtsVuelta.home === 0 ? 1 : 0)),
          goalsFor: -(oldMatch.ida.scoreAway + oldMatch.vuelta.scoreHome),
          goalsAgainst: -(oldMatch.ida.scoreHome + oldMatch.vuelta.scoreAway)
        }

        batch.update(doc(db, 'users', p1Id), {
          points: increment(revertP1.points),
          playedMatches: increment(revertP1.playedMatches),
          wins: increment(revertP1.wins),
          draws: increment(revertP1.draws),
          losses: increment(revertP1.losses),
          goalsFor: increment(revertP1.goalsFor),
          goalsAgainst: increment(revertP1.goalsAgainst)
        })
        
        batch.update(doc(db, 'users', p2Id), {
          points: increment(revertP2.points),
          playedMatches: increment(revertP2.playedMatches),
          wins: increment(revertP2.wins),
          draws: increment(revertP2.draws),
          losses: increment(revertP2.losses),
          goalsFor: increment(revertP2.goalsFor),
          goalsAgainst: increment(revertP2.goalsAgainst)
        })
      }
      
      const newPtsIda = calculatePoints(newIdaHome, newIdaAway)
      const newPtsVuelta = calculatePoints(newVueltaHome, newVueltaAway)
      
      const applyP1 = {
        points: newPtsIda.home + newPtsVuelta.away,
        playedMatches: 2,
        wins: (newPtsIda.home === 3 ? 1 : 0) + (newPtsVuelta.away === 3 ? 1 : 0),
        draws: (newPtsIda.home === 1 ? 1 : 0) + (newPtsVuelta.away === 1 ? 1 : 0),
        losses: (newPtsIda.home === 0 ? 1 : 0) + (newPtsVuelta.away === 0 ? 1 : 0),
        goalsFor: newIdaHome + newVueltaAway,
        goalsAgainst: newIdaAway + newVueltaHome
      }
      
      const applyP2 = {
        points: newPtsIda.away + newPtsVuelta.home,
        playedMatches: 2,
        wins: (newPtsIda.away === 3 ? 1 : 0) + (newPtsVuelta.home === 3 ? 1 : 0),
        draws: (newPtsIda.away === 1 ? 1 : 0) + (newPtsVuelta.home === 1 ? 1 : 0),
        losses: (newPtsIda.away === 0 ? 1 : 0) + (newPtsVuelta.home === 0 ? 1 : 0),
        goalsFor: newIdaAway + newVueltaHome,
        goalsAgainst: newIdaHome + newVueltaAway
      }
      
      batch.update(doc(db, 'users', p1Id), {
        points: increment(applyP1.points),
        playedMatches: increment(applyP1.playedMatches),
        wins: increment(applyP1.wins),
        draws: increment(applyP1.draws),
        losses: increment(applyP1.losses),
        goalsFor: increment(applyP1.goalsFor),
        goalsAgainst: increment(applyP1.goalsAgainst)
      })
      
      batch.update(doc(db, 'users', p2Id), {
        points: increment(applyP2.points),
        playedMatches: increment(applyP2.playedMatches),
        wins: increment(applyP2.wins),
        draws: increment(applyP2.draws),
        losses: increment(applyP2.losses),
        goalsFor: increment(applyP2.goalsFor),
        goalsAgainst: increment(applyP2.goalsAgainst)
      })
    }
    
    // 3. Update Match Documents
    const now = new Date()
    if (oldMatch.ida?.id) {
      batch.update(doc(db, 'matches', oldMatch.ida.id), {
        scoreHome: newIdaHome,
        scoreAway: newIdaAway,
        status: 'played',
        reportedAt: now,
        reportedBy: 'admin'
      })
    }
    if (oldMatch.vuelta?.id) {
      batch.update(doc(db, 'matches', oldMatch.vuelta.id), {
        scoreHome: newVueltaHome,
        scoreAway: newVueltaAway,
        status: 'played',
        reportedAt: now,
        reportedBy: 'admin'
      })
    }

    // Advancement logic for Playoffs in Manual Entry
    await checkAndPromotePlayoffWinner(batch, oldMatch, {
      idaHome: newIdaHome,
      idaAway: newIdaAway,
      vueltaHome: newVueltaHome,
      vueltaAway: newVueltaAway
    })
    
    await batch.commit()
    alert('Resultados registrados y estadísticas actualizadas.')
    showEditModal.value = false
  } catch (error) {
    console.error(error)
    alert('Error al guardar: ' + error.message)
  } finally {
    isSubmitting.value = false
  }
}


const groupedSections = computed(() => {
  const duelos = {}
  matches.value.forEach(m => {
    const players = [m.homeId || 'TBD1', m.awayId || 'TBD2'].sort()
    const originalFecha = m.fecha ? (m.fecha > 3 ? m.fecha - 3 : m.fecha) : null

    // For Playoffs, bracketKey is the primary unique identifier.
    // For regular season, we keep player pairing + phase/normalized fecha/group for uniqueness.
    const pairKey = m.bracketKey 
      ? `playoff_${m.bracketKey}` 
      : `${players.join('_')}_${m.phase || 'regular'}_F${originalFecha || 0}_G${m.group || 'none'}`

    // Apply Fecha/Phase Filter
    if (filterFecha.value !== 'all') {
      if (filterFecha.value === 'final') {
        if (m.phase !== 'Final' && !m.round) return
      } else if (originalFecha !== Number(filterFecha.value)) {
        return
      }
    }
    
    if (!duelos[pairKey]) {
      duelos[pairKey] = {
        homeName: m.homeId < m.awayId ? m.homeName : m.awayName,
        awayName: m.homeId < m.awayId ? m.awayName : m.homeName,
        homeId: m.homeId < m.awayId ? m.homeId : m.awayId,
        awayId: m.homeId < m.awayId ? m.awayId : m.homeId,
        group: m.group,
        scheduledTime: m.scheduledTime,
        status: 'pending',
        ida: null,
        vuelta: null,
        evidenceUrl: null,
        fecha: originalFecha,
        reportedAt: m.reportedAt
      }
    }
    
    if (m.type === 'Ida') duelos[pairKey].ida = m
    else duelos[pairKey].vuelta = m
    
    if (m.phase === 'Final') duelos[pairKey].phase = 'Final'
    if (m.round) duelos[pairKey].round = m.round

    if (m.evidenceUrl) duelos[pairKey].evidenceUrl = m.evidenceUrl
    if (m.reportedAt && (!duelos[pairKey].reportedAt || m.reportedAt > duelos[pairKey].reportedAt)) {
      duelos[pairKey].reportedAt = m.reportedAt
    }
    
    const s = m.status
    if (s === 'awaiting_approval') duelos[pairKey].status = 'awaiting_approval'
    else if (s === 'played' && duelos[pairKey].status !== 'awaiting_approval') duelos[pairKey].status = 'played'
    else if (s === 'scheduled' && !['played', 'awaiting_approval'].includes(duelos[pairKey].status)) duelos[pairKey].status = 'scheduled'
    else if (s === 'proposed' && !['scheduled', 'played', 'awaiting_approval'].includes(duelos[pairKey].status)) duelos[pairKey].status = 'proposed'
    
    if (m.scheduledTime) duelos[pairKey].scheduledTime = m.scheduledTime
  })

  let allDuelos = Object.values(duelos)

  // Apply Status Filter
  if (filterStatus.value !== 'all') {
    if (filterStatus.value === 'pending') {
      allDuelos = allDuelos.filter(d => d.status !== 'played' && d.status !== 'awaiting_approval')
    } else {
      allDuelos = allDuelos.filter(d => d.status === filterStatus.value)
    }
  }

  const sections = []

  // 1. Awaiting Approval (Urgent)
  const awaiting = allDuelos.filter(d => d.status === 'awaiting_approval')
  if (awaiting.length > 0) {
    sections.push({ title: 'Por Aprobar', status: 'awaiting_approval', pairs: awaiting })
  }

  // 2. Played (Finished) - Sorted by reportedAt descending
  const played = allDuelos.filter(d => d.status === 'played')
    .sort((a, b) => (b.reportedAt?.seconds || 0) - (a.reportedAt?.seconds || 0))
  if (played.length > 0) {
    sections.push({ title: 'Partidos Finalizados', status: 'played', pairs: played })
  }

  // 3. The rest grouped by Fecha or Round
  const pending = allDuelos.filter(d => d.status !== 'played' && d.status !== 'awaiting_approval')
  const fechas = {}
  const finals = []

  pending.forEach(d => {
    if (d.phase === 'Final' || d.round) {
      finals.push(d)
    } else {
      if (!fechas[d.fecha]) fechas[d.fecha] = []
      fechas[d.fecha].push(d)
    }
  })

  // Add Group Stage Fechas
  Object.keys(fechas).sort((a, b) => a - b).forEach(f => {
    sections.push({ title: `Fecha ${f}`, status: 'pending', pairs: fechas[f] })
  })

  // Add Final Phase
  if (finals.length > 0) {
    sections.push({ title: 'Fase Final (Playoffs)', status: 'pending', pairs: finals })
  }

  return sections
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
})
</script>

<template>
  <main class="p-4 md:p-8">
    <header class="mb-8 md:mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
      <div>
        <h1 class="text-2xl md:text-4xl font-black gradient-text">Monitoreo de Partidos</h1>
        <p class="text-white/40 mt-1 text-sm md:text-base">Supervisa negociaciones, resultados y evidencias</p>
      </div>

      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full md:w-auto">
        <!-- Filter Fecha -->
        <div class="relative w-full sm:w-auto">
          <select v-model="filterFecha" class="w-full sm:w-auto appearance-none bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:border-primary transition-all pr-8">
            <option value="all" class="bg-gray-900 text-white">Todas las Fechas</option>
            <option value="final" class="bg-gray-900 text-white font-black text-primary italic">🏆 Encuentros Finales</option>
            <option v-for="f in availableFechas" :key="f" :value="f" class="bg-gray-900 text-white">Fecha {{ f }}</option>
          </select>
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/20 text-[10px]">▼</div>
        </div>

        <!-- Filter Status -->
        <div class="flex bg-white/5 p-1 rounded-xl border border-white/10 w-full sm:w-auto overflow-x-auto no-scrollbar">
          <button 
            v-for="s in [
              { id: 'all', label: 'Todos' },
              { id: 'awaiting_approval', label: 'Por Aprobar' },
              { id: 'pending', label: 'Pendientes' },
              { id: 'played', label: 'Finalizados' }
            ]" 
            :key="s.id"
            @click="filterStatus = s.id"
            class="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all uppercase tracking-widest whitespace-nowrap flex-1 sm:flex-none text-center"
            :class="filterStatus === s.id ? 'bg-primary text-secondary shadow-lg shadow-primary/20' : 'text-white/40 hover:text-white'"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="loading" class="text-center p-12 text-white/40">Cargando monitoreo...</div>

    <div v-else class="space-y-12">
      <div v-for="section in groupedSections" :key="section.title">
        <h2 class="text-2xl font-black mb-6 flex items-center space-x-4">
          <span class="px-3 py-1 rounded-lg text-sm uppercase tracking-widest"
                :class="{
                  'bg-primary text-secondary': section.status === 'pending',
                  'bg-purple-500 text-white': section.status === 'awaiting_approval',
                  'bg-green-500 text-white': section.status === 'played'
                }">
            {{ section.title }}
          </span>
          <span class="h-px bg-white/10 flex-1"></span>
        </h2>
        
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div v-for="match in section.pairs" :key="match.ida?.id || match.vuelta?.id" class="glass-card p-6 border-l-4"
               :class="{
                 'border-l-green-500': match.status === 'played',
                 'border-l-blue-500': match.status === 'scheduled',
                 'border-l-yellow-500': match.status === 'proposed',
                 'border-l-purple-500': match.status === 'awaiting_approval',
                 'border-l-white/10': match.status === 'pending'
               }">
            
            <div class="flex justify-between items-start mb-6">
              <div>
                <div class="flex flex-wrap gap-2">
                  <span v-if="match.group" class="text-[10px] uppercase font-black px-2 py-1 bg-white/5 rounded border border-white/10">
                    Grupo {{ match.group }}
                  </span>
                  <span v-if="match.fecha" class="text-[10px] uppercase font-black px-2 py-1 bg-primary/10 text-primary rounded border border-primary/20">
                    Fecha {{ match.fecha }}
                  </span>
                  <span v-if="match.round" class="text-[10px] uppercase font-black px-2 py-1 bg-purple-500/10 text-purple-400 rounded border border-purple-500/20">
                    {{ match.round }}
                  </span>
                  <span v-if="match.ida?.bracketInfo" class="text-[10px] uppercase font-black px-2 py-1 bg-white/5 text-white/40 rounded border border-white/10 italic">
                    {{ match.ida.bracketInfo }}
                  </span>
                </div>
                <p class="text-lg font-bold mt-2">{{ match.homeName }} vs {{ match.awayName }}</p>
                <!-- Global Score Badge for Finals -->
                <div v-if="match.phase === 'Final' && (match.ida?.scoreHome !== null || match.vuelta?.scoreHome !== null)" class="mt-2 flex items-center space-x-2">
                  <span class="text-[9px] font-black uppercase tracking-widest text-white/40">Global:</span>
                  <span class="text-xs font-black text-primary">
                    {{ (match.ida?.scoreHome || 0) + (match.vuelta?.scoreAway || 0) }}
                    -
                    {{ (match.ida?.scoreAway || 0) + (match.vuelta?.scoreHome || 0) }}
                  </span>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                <!-- Manual Entry Button -->
                <button 
                  v-if="['scheduled', 'pending', 'proposed', 'awaiting_approval'].includes(match.status)" 
                  @click="startEditing(match)" 
                  class="px-3 py-1.5 bg-primary/10 text-primary text-[9px] font-black rounded-lg border border-primary/20 hover:bg-primary/20 transition-all uppercase tracking-tighter"
                >
                  Ingresa Resultado Aquí
                </button>

                <!-- WO Button (Small) -->
                <button 
                  v-if="['scheduled', 'pending', 'proposed'].includes(match.status)" 
                  @click="openWOModal(match)" 
                  class="w-6 h-6 flex items-center justify-center bg-orange-500/10 text-orange-400 rounded hover:bg-orange-500/20 transition-all"
                  title="Registrar WO"
                >
                  ⚠️
                </button>

                <span class="text-[10px] uppercase font-black px-2 py-1 rounded"
                      :class="{
                        'bg-green-500/20 text-green-400': match.status === 'played',
                        'bg-blue-500/20 text-blue-400': match.status === 'scheduled',
                        'bg-yellow-500/20 text-yellow-400': match.status === 'proposed',
                        'bg-purple-500/20 text-purple-400': match.status === 'awaiting_approval',
                        'bg-white/5 text-white/40': match.status === 'pending'
                      }">
                  {{ match.status === 'awaiting_approval' ? 'Por Aprobar' : match.status === 'played' ? 'Finalizado' : match.status }}
                </span>
              </div>
            </div>

            <!-- Pending Approval Section -->
            <div v-if="match.status === 'awaiting_approval'" class="mb-6">
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-purple-500/5 p-3 rounded-xl border border-purple-500/10 text-center">
                  <p class="text-[10px] uppercase text-white/40 font-bold mb-1">Ida</p>
                  <div class="flex justify-center items-center space-x-2 text-[10px] mb-1">
                    <span class="text-primary font-black">L: {{ match.ida?.homeName }}</span>
                    <span class="text-white/20">|</span>
                    <span class="text-white/40">V: {{ match.ida?.awayName }}</span>
                  </div>
                  <p class="text-xl font-black text-purple-400">{{ match.ida?.scoreHome }} - {{ match.ida?.scoreAway }}</p>
                </div>
                <div class="bg-purple-500/5 p-3 rounded-xl border border-purple-500/10 text-center">
                  <p class="text-[10px] uppercase text-white/40 font-bold mb-1">Vuelta</p>
                  <div class="flex justify-center items-center space-x-2 text-[10px] mb-1">
                    <span class="text-primary font-black">L: {{ match.vuelta?.homeName }}</span>
                    <span class="text-white/20">|</span>
                    <span class="text-white/40">V: {{ match.vuelta?.awayName }}</span>
                  </div>
                  <p class="text-xl font-black text-purple-400">{{ match.vuelta?.scoreHome }} - {{ match.vuelta?.scoreAway }}</p>
                </div>
              </div>
              <div class="flex space-x-2">
                <button @click="approveResults(match)" :disabled="isSubmitting" class="flex-1 py-2 bg-green-500 text-white text-xs font-black rounded-lg hover:bg-green-600 transition-all">✅ APROBAR</button>
                <button @click="rejectResults(match)" :disabled="isSubmitting" class="flex-1 py-2 bg-red-500/20 text-red-400 text-xs font-black rounded-lg border border-red-500/20 hover:bg-red-500/30 transition-all">❌ RECHAZAR</button>
              </div>
            </div>

            <div v-else-if="match.status === 'played'" class="mb-6">
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                  <p class="text-[10px] uppercase text-white/40 font-bold mb-1">Ida</p>
                  <div class="flex justify-center items-center space-x-2 text-[10px] mb-1">
                    <span class="text-primary font-black">L: {{ match.ida?.homeName }}</span>
                    <span class="text-white/20">|</span>
                    <span class="text-white/40">V: {{ match.ida?.awayName }}</span>
                  </div>
                  <p class="text-xl font-black text-primary">{{ match.ida?.scoreHome }} - {{ match.ida?.scoreAway }}</p>
                </div>
                <div class="bg-white/5 p-3 rounded-xl border border-white/5 text-center">
                  <p class="text-[10px] uppercase text-white/40 font-bold mb-1">Vuelta</p>
                  <div class="flex justify-center items-center space-x-2 text-[10px] mb-1">
                    <span class="text-primary font-black">L: {{ match.vuelta?.homeName }}</span>
                    <span class="text-white/20">|</span>
                    <span class="text-white/40">V: {{ match.vuelta?.awayName }}</span>
                  </div>
                  <p class="text-xl font-black text-primary">{{ match.vuelta?.scoreHome }} - {{ match.vuelta?.scoreAway }}</p>
                </div>
              </div>
              <button @click="startEditing(match)" class="w-full py-2 bg-white/5 text-white/40 text-[10px] font-black rounded-lg border border-white/10 hover:bg-white/10 hover:text-white transition-all uppercase tracking-widest">
                ✏️ Editar Resultados
              </button>
            </div>

            <div v-else-if="match.scheduledTime" class="mb-6 p-3 bg-white/5 rounded-xl border border-white/5">
              <p class="text-[10px] uppercase text-white/40 font-bold">Horario Acordado</p>
              <p class="font-bold text-primary">{{ match.scheduledTime }}</p>
            </div>

            <div v-if="match.evidenceUrl" class="mt-4">
              <p class="text-[10px] uppercase text-white/40 font-bold mb-2">📸 Evidencia</p>
              <a :href="match.evidenceUrl" target="_blank" class="block group relative overflow-hidden rounded-xl border border-white/10 aspect-video bg-black">
                <img :src="match.evidenceUrl" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 opacity-60 group-hover:opacity-100">
                <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span class="bg-primary text-secondary px-4 py-2 rounded-lg font-bold text-xs">Ver Pantallazo</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
      <div v-if="editingMatch" class="glass-card max-w-lg w-full border-primary/20">
        <h3 class="text-2xl font-black mb-8">Editar Resultados</h3>
        
        <div class="space-y-6">
          <!-- Ida -->
          <div class="p-6 bg-white/5 rounded-3xl border border-white/10">
            <p class="text-[10px] font-black text-primary uppercase mb-4 tracking-widest">Partido 1: IDA</p>
            <div class="flex items-center justify-between space-x-4">
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-primary mb-1">Local</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ editingMatch.ida?.homeName }}</p>
                <input v-model.number="editForm.idaHome" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
              <div class="text-2xl font-black text-white/10 italic">VS</div>
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-white/40 mb-1">Visitante</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ editingMatch.ida?.awayName }}</p>
                <input v-model.number="editForm.idaAway" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
            </div>
          </div>

          <!-- Vuelta -->
          <div class="p-6 bg-white/5 rounded-3xl border border-white/10">
            <p class="text-[10px] font-black text-primary uppercase mb-4 tracking-widest">Partido 2: VUELTA</p>
            <div class="flex items-center justify-between space-x-4">
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-primary mb-1">Local</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ editingMatch.vuelta?.homeName }}</p>
                <input v-model.number="editForm.vueltaHome" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
              <div class="text-2xl font-black text-white/10 italic">VS</div>
              <div class="flex-1 text-center">
                <p class="text-[10px] uppercase font-black text-white/40 mb-1">Visitante</p>
                <p class="text-xs font-bold mb-3 truncate text-white">{{ editingMatch.vuelta?.awayName }}</p>
                <input v-model.number="editForm.vueltaAway" type="number" min="0" class="w-20 bg-white/10 border border-white/20 rounded-2xl p-4 text-center text-2xl font-black text-white outline-none focus:border-primary">
              </div>
            </div>
          </div>

          <!-- Global Preview -->
          <div v-if="editingMatch.phase === 'Final' || editingMatch.round" class="p-4 bg-primary/10 rounded-2xl border border-primary/20 flex justify-between items-center">
            <div>
              <p class="text-[10px] font-black text-primary uppercase">Marcador Global</p>
              <p class="text-xs font-bold text-white/60">Resultado total ida y vuelta</p>
            </div>
            <div class="text-2xl font-black text-primary">
              {{ (editForm.idaHome || 0) + (editForm.vueltaAway || 0) }}
              <span class="text-white/20 px-1">-</span>
              {{ (editForm.idaAway || 0) + (editForm.vueltaHome || 0) }}
            </div>
          </div>
        </div>

        <div class="flex space-x-3 mt-8">
          <button @click="showEditModal = false" class="flex-1 py-4 text-white/40 font-bold hover:text-white transition-all">Cancelar</button>
          <button @click="saveEdit" :disabled="isSubmitting" class="flex-[2] btn-primary py-4">
            {{ isSubmitting ? 'Guardando...' : 'Guardar Cambios' }}
          </button>
        </div>
      </div>
    </div>

    <!-- WO Modal -->
    <div v-if="showWOModal && woMatch" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80">
      <div class="glass-card max-w-md w-full border-orange-500/20">
        <h3 class="text-2xl font-black mb-4">⚠️ Registrar Walk Over</h3>
        <p class="text-white/60 mb-8">Un jugador no se presentó. Selecciona quién gana por WO (3-0 en ambos partidos = 6 puntos):</p>
        
        <div class="space-y-3 mb-8">
          <button 
            @click="handleWalkOver(woMatch.homeId)" 
            :disabled="isSubmitting"
            class="w-full p-4 bg-green-500/10 text-green-400 font-bold rounded-xl border-2 border-green-500/20 hover:bg-green-500/20 transition-all text-left"
          >
            <div class="flex items-center justify-between">
              <span>🏆 {{ woMatch.homeName }}</span>
              <span class="text-xs opacity-60">Gana por WO</span>
            </div>
          </button>
          
          <button 
            @click="handleWalkOver(woMatch.awayId)" 
            :disabled="isSubmitting"
            class="w-full p-4 bg-green-500/10 text-green-400 font-bold rounded-xl border-2 border-green-500/20 hover:bg-green-500/20 transition-all text-left"
          >
            <div class="flex items-center justify-between">
              <span>🏆 {{ woMatch.awayName }}</span>
              <span class="text-xs opacity-60">Gana por WO</span>
            </div>
          </button>
        </div>

        <button @click="showWOModal = false" class="w-full py-3 text-white/40 font-bold hover:text-white transition-all">
          Cancelar
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
input[type=number]::-webkit-inner-spin-button, 
input[type=number]::-webkit-outer-spin-button { 
  -webkit-appearance: none; 
  margin: 0; 
}
</style>
