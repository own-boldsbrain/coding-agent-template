param(
      [string[]]$ContainerNames = @('coding-agent-app', 'a49bbcc9908a'),
      [string[]]$ImageNames = @('coding-agent-template-app:latest'),
      [string[]]$VolumePrefixes = @('sandbox-', 'coding-agent-app', 'coding-agent-template'),
      [switch]$WhatIf
)

function Write-Step {
      param([string]$Message)
      Write-Host "[docker-reset] $Message"
}

function Remove-Containers {
      param([string[]]$Names)
      foreach ($name in $Names) {
            if (-not $name) { continue }
            $containers = docker ps -a --filter "name=^$name$" --format '{{.ID}}' 2>$null
            if (-not $containers) { continue }
            foreach ($id in $containers) {
                  Write-Step "Removing container $name ($id)"
                  if (-not $WhatIf) {
                        docker rm -f $id | Out-Null
                  }
            }
      }

      $labelled = docker ps -a --filter "label=coding-agent-template" --format '{{.ID}}' 2>$null
      foreach ($id in $labelled) {
            Write-Step "Removing labelled container $id"
            if (-not $WhatIf) {
                  docker rm -f $id | Out-Null
            }
      }
}

function Remove-Images {
      param([string[]]$Names)
      foreach ($name in $Names) {
            if (-not $name) { continue }
            $images = docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | Where-Object { $_.StartsWith($name) }
            foreach ($entry in $images) {
                  $parts = $entry.Split(' ')
                  if ($parts.Length -lt 2) { continue }
                  $imageName = $parts[0]
                  $imageId = $parts[1]
                  Write-Step "Removing image $imageName ($imageId)"
                  if (-not $WhatIf) {
                        docker rmi -f $imageId | Out-Null
                  }
            }
      }
}

function Remove-Volumes {
      param([string[]]$Prefixes)
      $volumes = docker volume ls --format '{{.Name}}' 2>$null
      foreach ($volume in $volumes) {
            foreach ($prefix in $Prefixes) {
                  if (-not $prefix) { continue }
                  if ($volume.StartsWith($prefix)) {
                        Write-Step "Removing volume $volume"
                        if (-not $WhatIf) {
                              docker volume rm -f $volume | Out-Null
                        }
                        break
                  }
            }
      }
}

try {
      docker version | Out-Null
}
catch {
      Write-Error 'Docker CLI não encontrado. Instale Docker Desktop antes de rodar este script.'
      exit 1
}

Write-Step 'Iniciando limpeza do ambiente antigo (containers, imagens e volumes)'
Remove-Containers -Names $ContainerNames
Remove-Images -Names $ImageNames
Remove-Volumes -Prefixes $VolumePrefixes
Write-Step 'Limpeza concluída. Recursos necessários serão recriados automaticamente pelo sandbox Docker.'
