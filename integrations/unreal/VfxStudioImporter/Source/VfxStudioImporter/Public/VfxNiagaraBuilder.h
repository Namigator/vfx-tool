#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "VfxNiagaraBuilder.generated.h"

/**
 * Editor-only, Python-callable (BlueprintCallable) entry points for the headless
 * Niagara-building spike. Every function logs to the "VfxSpike" log category with
 * plain ASCII so a commandlet/Python run can be verified from -log / saved logs.
 */
UCLASS()
class VFXSTUDIOIMPORTER_API UVfxNiagaraBuilder : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Builds /Game/Spike/NS_CppBuilt from two engine emitter templates, sets a few
	 *  module inputs, assigns a sprite material, compiles and saves. Returns true on
	 *  full success; logs at each step so partial failure is diagnosable. */
	UFUNCTION(BlueprintCallable, Category = "VfxSpike")
	static bool BuildDemoSystem(const FString& AssetPath);

	/** Spawns a NiagaraActor running the given system in a fresh empty level, then
	 *  renders one frame to a PNG via a scene capture. Returns true and writes
	 *  OutPngPath on success. */
	UFUNCTION(BlueprintCallable, Category = "VfxSpike")
	static bool RenderSystemToPng(const FString& NiagaraSystemAssetPath, const FString& OutputPngPath, float SimSeconds);

	/** Diagnostic: loads an emitter template and logs every module (function-call node) in its Spawn, Update and
	 *  EmitterUpdate scripts, plus each module's input pin names/types, to LogVfxSpike. Used once to ground the
	 *  real importer's module-name mapping in actual template data instead of guessing. */
	UFUNCTION(BlueprintCallable, Category = "VfxSpike")
	static void EnumerateEmitterTemplate(const FString& EmitterAssetPath);
};
