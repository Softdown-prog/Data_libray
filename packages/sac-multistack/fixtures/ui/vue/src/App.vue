<script setup lang="ts">
import {ref} from "vue";
const count=ref(0);
function increment():void { count.value+=1; }
</script>
<template>
  <button type="button" @click="increment">Count {{count.toFixed(0)}}</button>
</template>
