#pragma once

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "VfxStudioImportCommandlet.generated.h"

/**
 * Headless entry point: UnrealEditor-Cmd.exe <Project>.uproject -run=VfxStudioImport -Package="<dir>" -Dest=/Game/VFXStudio/<name>
 * Calls UVfxNiagaraImporter::ImportPackage and exits 0 on success, 1 on failure (so a CI/script caller can check
 * the process exit code instead of scraping the log).
 */
UCLASS()
class VFXSTUDIOIMPORTER_API UVfxStudioImportCommandlet : public UCommandlet
{
	GENERATED_BODY()
public:
	virtual int32 Main(const FString& Params) override;
};
