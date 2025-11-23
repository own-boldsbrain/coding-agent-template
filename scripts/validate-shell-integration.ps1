# Script de Validação - VS Code Terminal Shell Integration
# Execute este script em um NOVO terminal para verificar o setup

Write-Output "=" * 70
Write-Output "  VS Code Terminal Shell Integration - Validação Completa"
Write-Output "=" * 70
Write-Output ""

$testsPassed = 0
$testsTotal = 0

function Test-Feature {
      param(
            [string]$TestName,
            [scriptblock]$TestCode,
            [string]$ExpectedResult
      )
    
      $script:testsTotal++
      Write-Output "[$script:testsTotal] Testando: $TestName"
    
      try {
            $result = & $TestCode
            if ($result) {
                  Write-Output "    ✅ PASS: $ExpectedResult"
                  $script:testsPassed++
            }
            else {
                  Write-Output "    ❌ FAIL: $ExpectedResult não encontrado"
            }
      }
      catch {
            Write-Output "    ❌ ERROR: $_"
      }
      Write-Output ""
}

# Teste 1: Verificar TERM_PROGRAM
Test-Feature -TestName "Variável TERM_PROGRAM" -TestCode {
      $env:TERM_PROGRAM -eq "vscode"
} -ExpectedResult "Deve ser 'vscode'"

# Teste 2: Verificar Profile existe
Test-Feature -TestName "PowerShell Profile" -TestCode {
      Test-Path $PROFILE
} -ExpectedResult "Profile deve existir em $PROFILE"

# Teste 3: Verificar conteúdo do profile
Test-Feature -TestName "Profile contém shell integration" -TestCode {
      (Get-Content $PROFILE -Raw) -match "shell.integration|TERM_PROGRAM"
} -ExpectedResult "Profile deve conter referência a shell integration"

# Teste 4: Verificar VSCODE_SHELL_INTEGRATION
Test-Feature -TestName "Variável VSCODE_SHELL_INTEGRATION" -TestCode {
      $null -ne $env:VSCODE_SHELL_INTEGRATION
} -ExpectedResult "Variável deve estar definida (indica shell integration ativa)"

# Teste 5: Verificar settings.json
Test-Feature -TestName "VS Code Settings" -TestCode {
      Test-Path ".vscode/settings.json"
} -ExpectedResult "Settings.json deve existir"

# Teste 6: Verificar configurações de terminal
Test-Feature -TestName "Configurações de terminal aplicadas" -TestCode {
      if (Test-Path ".vscode/settings.json") {
            $settings = Get-Content ".vscode/settings.json" -Raw | ConvertFrom-Json
            $terminalSettings = $settings.PSObject.Properties | Where-Object { $_.Name -like "terminal.*" }
            $terminalSettings.Count -ge 10
      }
      else {
            $false
      }
} -ExpectedResult "Pelo menos 10 configurações de terminal"

# Teste 7: Testar comando de histórico
Test-Feature -TestName "Histórico do PowerShell" -TestCode {
      (Get-History -ErrorAction SilentlyContinue).Count -ge 0
} -ExpectedResult "Histórico acessível"

# Teste 8: Verificar Get-Command funciona
Test-Feature -TestName "Get-Command disponível" -TestCode {
      $null -ne (Get-Command Get-Date -ErrorAction SilentlyContinue)
} -ExpectedResult "Comandos básicos do PowerShell funcionam"

# Resumo
Write-Output "=" * 70
Write-Output "  Resumo dos Testes"
Write-Output "=" * 70
Write-Output ""
Write-Output "  Total de testes: $testsTotal"
Write-Output "  Testes passados: $testsPassed"
Write-Output "  Testes falhados: $($testsTotal - $testsPassed)"
Write-Output ""

$successRate = [math]::Round(($testsPassed / $testsTotal) * 100, 2)
Write-Output "  Taxa de sucesso: $successRate%"
Write-Output ""

if ($testsPassed -eq $testsTotal) {
      Write-Output "  🎉 SUCESSO! Shell Integration está configurada corretamente!"
      Write-Output ""
      Write-Output "  Próximos passos:"
      Write-Output "  1. Hover sobre a aba deste terminal para ver 'Shell integration quality'"
      Write-Output "  2. Execute alguns comandos e observe as decorações (círculos azuis/vermelhos)"
      Write-Output "  3. Teste Ctrl+Alt+R para 'Run Recent Command'"
      Write-Output "  4. Teste Ctrl+Up/Down para navegar entre comandos"
}
elseif ($testsPassed -ge ($testsTotal * 0.7)) {
      Write-Output "  ⚠️  PARCIAL: Maioria dos testes passou, mas há alguns problemas."
      Write-Output "  Revise os testes falhados acima."
}
else {
      Write-Output "  ❌ FALHA: Muitos testes falharam."
      Write-Output "  Soluções:"
      Write-Output "  1. Certifique-se de estar executando em um NOVO terminal"
      Write-Output "  2. Verifique se o profile foi criado: Test-Path $PROFILE"
      Write-Output "  3. Recarregue o profile: . $PROFILE"
      Write-Output "  4. Consulte docs/TERMINAL_SETUP.md para troubleshooting"
}

Write-Output ""
Write-Output "=" * 70
Write-Output ""

# Informações adicionais
Write-Output "Informações do Ambiente:"
Write-Output "  PowerShell Version: $($PSVersionTable.PSVersion)"
Write-Output "  TERM_PROGRAM: $env:TERM_PROGRAM"
Write-Output "  Profile Path: $PROFILE"
Write-Output "  Workspace: $(Get-Location)"
Write-Output ""
