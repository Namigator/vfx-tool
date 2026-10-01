// VfxNiagaraImporter: reads a VFX Studio Unreal export package (effect.json + Textures/*.png) and builds a
// NiagaraSystem. The module/input names used below are NOT guessed: they were confirmed on 2026-10-01 against the
// real UE 5.8 stock templates via FNiagaraStackGraphUtilities::GetStackFunctionInputs (an exported, non-legacy
// overload -- the module-name substring technique from the earlier spike (VfxNiagaraBuilder.cpp) is reused to find
// the UNiagaraNodeFunctionCall node, then GetOrCreateStackFunctionInputOverridePin sets a literal on it by exact
// parameter name). Confirmed names per template (see F:\Dev2\VFX-Tool\work\unreal-spike\logs\13_stdout.log for the
// raw dump this was read from):
//   Fountain:          SpawnRate.SpawnRate (float) | GravityForce.Gravity (Vector3f) | Drag.Drag (float)
//                      InitializeParticle.{Lifetime Min, Lifetime Max, Sprite Size Min, Sprite Size Max, Color}
//                      ShapeLocation.{Sphere Radius, Cone Angle, Box Size}  AddVelocity.{Velocity Speed, Cone Axis}
//   SimpleSpriteBurst: SpawnBurst_Instantaneous.{Spawn Count, Spawn Time} | InitializeParticle (same as above)
//   Minimal:           InitializeParticle only (NO spawn module -- see fromPlan.ts's template-selection comment)
#include "VfxNiagaraImporter.h"

#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "HAL/PlatformFileManager.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#include "NiagaraSystem.h"
#include "NiagaraSystemFactoryNew.h"
#include "NiagaraEmitter.h"
#include "NiagaraEmitterHandle.h"
#include "NiagaraScript.h"
#include "NiagaraScriptSource.h"
#include "NiagaraGraph.h"
#include "NiagaraNodeOutput.h"
#include "NiagaraNodeFunctionCall.h"
#include "NiagaraNodeInput.h"
#include "NiagaraDataInterface.h"
#include "NiagaraDataInterfaceCurve.h"
#include "Materials/MaterialExpressionTextureCoordinate.h"
#include "NiagaraSpriteRendererProperties.h"
#include "ViewModels/Stack/NiagaraStackGraphUtilities.h"
#include "ViewModels/Stack/NiagaraParameterHandle.h"

#include "Factories/TextureFactory.h"
#include "Engine/Texture2D.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Factories/MaterialInstanceConstantFactoryNew.h"
#include "Materials/MaterialExpressionTextureSampleParameter2D.h"
#include "Materials/MaterialExpressionParticleColor.h"
#include "Materials/MaterialExpressionMultiply.h"
#include "MaterialEditingLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogVfxImporter, Log, All);

namespace
{
	bool SaveAssetObj(UObject* Asset)
	{
		if (!Asset) return false;
		UPackage* Package = Asset->GetOutermost();
		Package->MarkPackageDirty();
		Package->FullyLoad();
		const FString PackageFileName = FPackageName::LongPackageNameToFilename(Package->GetName(), FPackageName::GetAssetPackageExtension());
		FSavePackageArgs SaveArgs;
		SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
		SaveArgs.SaveFlags = SAVE_NoError;
		const bool bSaved = UPackage::SavePackage(Package, Asset, *PackageFileName, SaveArgs);
		UE_LOG(LogVfxImporter, Warning, TEXT("Save %s -> %s : %s"), *Asset->GetName(), *PackageFileName, bSaved ? TEXT("OK") : TEXT("FAILED"));
		return bSaved;
	}

	FVector JsonVec3(const TArray<TSharedPtr<FJsonValue>>* Arr)
	{
		if (!Arr || Arr->Num() < 3) return FVector::ZeroVector;
		return FVector((*Arr)[0]->AsNumber(), (*Arr)[1]->AsNumber(), (*Arr)[2]->AsNumber());
	}

	/** Finds a module (function-call) node by FunctionName substring and overrides one named input literal. Mirrors
	 *  the technique proven in VfxNiagaraBuilder.cpp (GetOrderedModuleNodes/FindOutputNode are not exported in 5.8,
	 *  so this walks UEdGraph::Nodes directly). Logs whether the module was found so a missing module is never a
	 *  silent no-op. */
	bool OverrideLiteral(UNiagaraGraph* Graph, const TCHAR* ModuleNameSubstring, const TCHAR* InputName, const FNiagaraTypeDefinition& Type, const FString& LiteralValue)
	{
		if (!Graph) return false;
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			UNiagaraNodeFunctionCall* ModuleNode = Cast<UNiagaraNodeFunctionCall>(Node);
			if (!ModuleNode || !ModuleNode->GetFunctionName().Contains(ModuleNameSubstring)) continue;
			// The override pin must be keyed by the ALIASED module input ("<ModuleName>.<Input>", built from
			// "Module.<Input>"); a bare "<Input>" name compiles to an orphan parameter ("Only one namespace entry found
			// for: LifetimeMin") and the system then refuses to activate.
			const FNiagaraParameterHandle ModuleHandle = FNiagaraParameterHandle::CreateModuleParameterHandle(FName(InputName));
			const FNiagaraParameterHandle Handle = FNiagaraParameterHandle::CreateAliasedModuleParameterHandle(ModuleHandle, ModuleNode);
			UEdGraphPin& OverridePin = FNiagaraStackGraphUtilities::GetOrCreateStackFunctionInputOverridePin(*ModuleNode, Handle, Type, FGuid(), FGuid());
			OverridePin.DefaultValue = LiteralValue;
			UE_LOG(LogVfxImporter, Log, TEXT("    %s.%s = %s"), *ModuleNode->GetFunctionName(), InputName, *LiteralValue);
			return true;
		}
		UE_LOG(LogVfxImporter, Warning, TEXT("    module containing '%s' not found (input '%s' not set)"), ModuleNameSubstring, InputName);
		return false;
	}
	/** UNiagaraNodeInput::GetDataInterface is not exported from NiagaraEditor; read the UPROPERTY through reflection. */
	UNiagaraDataInterface* NodeInputDataInterface(const UNiagaraNodeInput* In)
	{
		static FObjectProperty* Prop = FindFProperty<FObjectProperty>(UNiagaraNodeInput::StaticClass(), TEXT("DataInterface"));
		return Prop ? Cast<UNiagaraDataInterface>(Prop->GetObjectPropertyValue_InContainer(In)) : nullptr;
	}
	FString FloatLit(double V) { return FString::SanitizeFloat(V); }
	FString Vec3Lit(const FVector& V) { return FString::Printf(TEXT("%f,%f,%f"), V.X, V.Y, V.Z); }
	// Pin default-value syntax per Niagara type (NiagaraEditor/Private/TypeEditorUtilities): Vector3/4 are bare
	// "x,y,z"; Vector2 is "(X=..., Y=...)"; LinearColor is FLinearColor::ToString() "(R=...,G=...,B=...,A=...)".
	// A wrong syntax silently parses as zero (black particles, zero-size sprites).
	FString Vec2Lit(double A, double B) { return FString::Printf(TEXT("(X=%3.3f, Y=%3.3f)"), A, B); }
	FString ColorLit(const FLinearColor& C) { return C.ToString(); }

	/** Every override target for one emitter, applied to every usage graph reachable from the emitter (Spawn/Update
	 *  share one graph in this Niagara version, per the 2026-10-01 enumeration -- see file header). */
	struct FOverrideCtx { UNiagaraGraph* Graph = nullptr; };

	UNiagaraEmitter* LoadTemplate(const TCHAR* Path)
	{
		UNiagaraEmitter* E = LoadObject<UNiagaraEmitter>(nullptr, Path);
		if (!E) UE_LOG(LogVfxImporter, Error, TEXT("Failed to load emitter template: %s"), Path);
		return E;
	}

	/** Builds (once) the shared Additive/Translucent unlit sprite base materials under DestRoot/_Materials, or loads
	 *  them if already present from a previous import into the same project. */
	UMaterial* GetOrCreateBaseMaterial(const FString& DestRoot, bool bAdditive, int32 Columns = 1, int32 Rows = 1)
	{
		// One base per blend mode and flipbook grid: the texture coordinates are scaled to the FIRST cell of the sheet
		// (a 4x4 flipbook would otherwise draw all 16 frames at once as a square).
		const FString Grid = (Columns > 1 || Rows > 1) ? FString::Printf(TEXT("_%dx%d"), Columns, Rows) : FString();
		const FString Name = FString(bAdditive ? TEXT("M_VfxStudio_Additive") : TEXT("M_VfxStudio_Translucent")) + Grid;
		const FString PackagePath = DestRoot / TEXT("_Materials");
		const FString AssetPath = PackagePath / Name;
		if (UMaterial* Existing = LoadObject<UMaterial>(nullptr, *(AssetPath + TEXT(".") + Name)))
		{
			return Existing;
		}
		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UObject* NewAsset = AssetTools.CreateAsset(Name, PackagePath, UMaterial::StaticClass(), nullptr);
		UMaterial* Mat = Cast<UMaterial>(NewAsset);
		if (!Mat) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(Material %s) failed"), *Name); return nullptr; }

		Mat->SetShadingModel(MSM_Unlit);
		Mat->BlendMode = bAdditive ? BLEND_Additive : BLEND_Translucent;
		Mat->TwoSided = true;

		UMaterialExpression* TexExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionTextureSampleParameter2D::StaticClass(), -300, 0);
		if (auto* TexParam = Cast<UMaterialExpressionTextureSampleParameter2D>(TexExpr)) TexParam->ParameterName = TEXT("Texture");
		if (Columns > 1 || Rows > 1)
		{
			UMaterialExpression* UvExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionTextureCoordinate::StaticClass(), -550, 0);
			if (auto* Uv = Cast<UMaterialExpressionTextureCoordinate>(UvExpr)) { Uv->UTiling = 1.0f / FMath::Max(1, Columns); Uv->VTiling = 1.0f / FMath::Max(1, Rows); }
			UMaterialEditingLibrary::ConnectMaterialExpressions(UvExpr, TEXT(""), TexExpr, TEXT("UVs"));
		}
		UMaterialExpression* ParticleColorExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionParticleColor::StaticClass(), -300, 200);
		UMaterialExpression* MulRgbExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionMultiply::StaticClass(), 0, 0);
		UMaterialEditingLibrary::ConnectMaterialExpressions(TexExpr, TEXT("RGB"), MulRgbExpr, TEXT("A"));
		UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("RGB"), MulRgbExpr, TEXT("B"));
		UMaterialEditingLibrary::ConnectMaterialProperty(MulRgbExpr, TEXT(""), MP_EmissiveColor); // MSM_Unlit ignores BaseColor entirely; only Emissive is visible for either blend mode.
		if (!bAdditive)
		{
			UMaterialExpression* MulAlphaExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionMultiply::StaticClass(), 0, 200);
			UMaterialEditingLibrary::ConnectMaterialExpressions(TexExpr, TEXT("A"), MulAlphaExpr, TEXT("A"));
			UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("A"), MulAlphaExpr, TEXT("B"));
			UMaterialEditingLibrary::ConnectMaterialProperty(MulAlphaExpr, TEXT(""), MP_Opacity);
		}
		else
		{
			// Additive particles fade with ParticleColor.A (opacity over life): emissive = texture.rgb * colour.rgb * colour.a.
			// (Feeding A into the same multiply's B replaced the colour input: glows ignored their colour.)
			UMaterialExpression* FadeExpr = UMaterialEditingLibrary::CreateMaterialExpression(Mat, UMaterialExpressionMultiply::StaticClass(), 200, 0);
			UMaterialEditingLibrary::ConnectMaterialExpressions(MulRgbExpr, TEXT(""), FadeExpr, TEXT("A"));
			UMaterialEditingLibrary::ConnectMaterialExpressions(ParticleColorExpr, TEXT("A"), FadeExpr, TEXT("B"));
			UMaterialEditingLibrary::ConnectMaterialProperty(FadeExpr, TEXT(""), MP_EmissiveColor);
		}
		UMaterialEditingLibrary::RecompileMaterial(Mat);
		SaveAssetObj(Mat);
		return Mat;
	}

	UMaterialInstanceConstant* GetOrCreateTextureMaterial(const FString& DestRoot, UMaterial* Base, UTexture2D* Texture, const FString& BlendTag)
	{
		if (!Base) return nullptr;
		const FString Name = FString::Printf(TEXT("MI_%s_%s"), *Texture->GetName(), *BlendTag);
		const FString PackagePath = DestRoot / TEXT("_Materials");
		if (UMaterialInstanceConstant* Existing = LoadObject<UMaterialInstanceConstant>(nullptr, *((PackagePath / Name) + TEXT(".") + Name)))
		{
			return Existing;
		}
		IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
		UMaterialInstanceConstantFactoryNew* Factory = NewObject<UMaterialInstanceConstantFactoryNew>();
		Factory->InitialParent = Base;
		UObject* NewAsset = AssetTools.CreateAsset(Name, PackagePath, UMaterialInstanceConstant::StaticClass(), Factory);
		UMaterialInstanceConstant* MIC = Cast<UMaterialInstanceConstant>(NewAsset);
		if (!MIC) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(MIC %s) failed"), *Name); return nullptr; }
		UMaterialEditingLibrary::SetMaterialInstanceTextureParameterValue(MIC, TEXT("Texture"), Texture);
		SaveAssetObj(MIC);
		return MIC;
	}

	UTexture2D* ImportTexture(const FString& PngFile, const FString& DestRoot)
	{
		const FString AssetName = FPaths::GetBaseFilename(PngFile);
		const FString PackagePath = DestRoot / TEXT("Textures");
		if (UTexture2D* Existing = LoadObject<UTexture2D>(nullptr, *((PackagePath / AssetName) + TEXT(".") + AssetName)))
		{
			return Existing;
		}
		UTextureFactory* Factory = NewObject<UTextureFactory>();
		Factory->SuppressImportOverwriteDialog();
		UPackage* Package = CreatePackage(*(PackagePath / AssetName));
		bool bCancelled = false;
		UTexture2D* Tex = Cast<UTexture2D>(Factory->FactoryCreateFile(UTexture2D::StaticClass(), Package, FName(*AssetName), RF_Public | RF_Standalone, PngFile, nullptr, GWarn, bCancelled));
		if (!Tex) { UE_LOG(LogVfxImporter, Error, TEXT("Texture import failed: %s"), *PngFile); return nullptr; }
		Tex->CompressionSettings = TC_EditorIcon; // Preserve sharp alpha edges on flipbook sheets; no mip-chain artifacts on small sheets.
		Tex->MipGenSettings = TMGS_NoMipmaps;
		Tex->PostEditChange();
		FAssetRegistryModule::AssetCreated(Tex);
		SaveAssetObj(Tex);
		return Tex;
	}

	/** Linear sample of a {t, <field>} key list at normalized life t. */
	double SampleKeys(const TArray<TSharedPtr<FJsonValue>>* Keys, double T, const TCHAR* Field, double Fallback)
	{
		if (!Keys || Keys->Num() == 0) return Fallback;
		const auto At = [&](int32 i, const TCHAR* F) { return (*Keys)[i]->AsObject()->GetNumberField(F); };
		if (T <= At(0, TEXT("t"))) return At(0, Field);
		for (int32 i = 1; i < Keys->Num(); i++)
		{
			const double T0 = At(i - 1, TEXT("t")), T1 = At(i, TEXT("t"));
			if (T <= T1) { const double U = T1 > T0 ? (T - T0) / (T1 - T0) : 0.0; return At(i - 1, Field) + (At(i, Field) - At(i - 1, Field)) * U; }
		}
		return At(Keys->Num() - 1, Field);
	}

	/** Average of a {t, v} curve over life 0..1 (trapezoids on a fine grid). */
	double AverageKeys(const TArray<TSharedPtr<FJsonValue>>* Keys, double Fallback)
	{
		if (!Keys || Keys->Num() == 0) return Fallback;
		double Sum = 0.0; const int32 N = 32;
		for (int32 i = 0; i <= N; i++) Sum += SampleKeys(Keys, double(i) / N, TEXT("v"), Fallback) * ((i == 0 || i == N) ? 0.5 : 1.0);
		return Sum / N;
	}

	/** Writes opacity-over-life into every "Scale Alpha" float-curve data interface of the graph (the stock templates'
	 *  Scale Color module reads Scale Alpha from a Float-from-Curve dynamic input over normalized age). */
	int32 SetScaleAlphaCurve(UNiagaraGraph* Graph, const TArray<TSharedPtr<FJsonValue>>* Keys)
	{
		if (!Graph || !Keys || Keys->Num() == 0) return 0;
		int32 Done = 0;
		for (UEdGraphNode* Node : Graph->Nodes)
		{
			UNiagaraNodeInput* In = Cast<UNiagaraNodeInput>(Node);
			if (!In || !In->Input.GetName().ToString().StartsWith(TEXT("Scale Alpha"))) continue;
			UNiagaraDataInterfaceCurve* Curve = Cast<UNiagaraDataInterfaceCurve>(NodeInputDataInterface(In));
			if (!Curve) continue;
			Curve->Modify();
			Curve->Curve.Reset();
			for (const auto& K : *Keys) { const auto O = K->AsObject(); Curve->Curve.AddKey(O->GetNumberField(TEXT("t")), O->GetNumberField(TEXT("v"))); }
			Curve->UpdateLUT();
			Done++;
		}
		UE_LOG(LogVfxImporter, Log, TEXT("    Scale Alpha curve set on %d data interface(s) (%d keys)"), Done, Keys->Num());
		return Done;
	}

	/** Applies the module-input overrides shared by every emitter, then the template-specific ones. Shape/AddVelocity
	 *  are skipped (module not found, logged) rather than guessed when a template lacks them. */
	void ApplyEmitterOverrides(UNiagaraGraph* Graph, const TSharedPtr<FJsonObject>& E, const FString& Template)
	{
		const auto F = FNiagaraTypeDefinition::GetFloatDef();
		const auto V2 = FNiagaraTypeDefinition::GetVec2Def();
		const auto V3 = FNiagaraTypeDefinition::GetVec3Def();
		const auto Col = FNiagaraTypeDefinition::GetColorDef();

		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Lifetime Min"), F, FloatLit(E->GetNumberField(TEXT("lifetimeSecMin"))));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Lifetime Max"), F, FloatLit(E->GetNumberField(TEXT("lifetimeSecMax"))));
		// Size over life: no stock size-curve module, so use the life-average size (flames grow x3.7; the birth size alone
		// draws them far too small). sizeOverLife values are absolute cm around the min/max midpoint.
		const double SMin = E->GetNumberField(TEXT("sizeCmMin")), SMax = E->GetNumberField(TEXT("sizeCmMax")), SMid = FMath::Max(0.001, (SMin + SMax) / 2.0);
		const TArray<TSharedPtr<FJsonValue>>* SizeKeys = nullptr; E->TryGetArrayField(TEXT("sizeOverLife"), SizeKeys);
		const double SizeScale = AverageKeys(SizeKeys, SMid) / SMid;
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Sprite Size Min"), V2, Vec2Lit(SMin * SizeScale, SMin * SizeScale));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Sprite Size Max"), V2, Vec2Lit(SMax * SizeScale, SMax * SizeScale));
		// The stock templates size sprites in "uniform" mode, which reads these instead of the Vector2 pair above.
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Uniform Sprite Size Min"), F, FloatLit(SMin * SizeScale));
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Uniform Sprite Size Max"), F, FloatLit(SMax * SizeScale));

		// Colour over life: no stock colour-curve module, so use the colour averaged over the visible first 60 % of life
		// (keeps the white-hot start and the orange body; a single mid-life sample multiplied into an already orange flame
		// texture reads deep red). Averaged in linear space. Opacity over life is exact: the template's Scale Alpha curve.
		const TArray<TSharedPtr<FJsonValue>>* ColorKeys = nullptr; E->TryGetArrayField(TEXT("colorOverLife"), ColorKeys);
		FLinearColor Body(0, 0, 0, 1);
		{
			const int32 N = 12;
			for (int32 i = 0; i <= N; i++)
			{
				const double T = 0.6 * i / N;
				Body += FLinearColor(FColor(
					(uint8)FMath::Clamp(SampleKeys(ColorKeys, T, TEXT("r"), 1.0) * 255.0, 0.0, 255.0),
					(uint8)FMath::Clamp(SampleKeys(ColorKeys, T, TEXT("g"), 1.0) * 255.0, 0.0, 255.0),
					(uint8)FMath::Clamp(SampleKeys(ColorKeys, T, TEXT("b"), 1.0) * 255.0, 0.0, 255.0)));
			}
			Body.R /= (N + 1); Body.G /= (N + 1); Body.B /= (N + 1);
		}
		const FLinearColor InitColor(Body.R, Body.G, Body.B, 1.0f);
		OverrideLiteral(Graph, TEXT("InitializeParticle"), TEXT("Color"), Col, ColorLit(InitColor));
		const TArray<TSharedPtr<FJsonValue>>* OpacityKeys = nullptr;
		if (E->TryGetArrayField(TEXT("opacityOverLife"), OpacityKeys)) SetScaleAlphaCurve(Graph, OpacityKeys);

		if (Template == TEXT("Fountain"))
		{
			// Peak of the sparse rateOverTime step track (one constant SpawnRate; full time-track is out of scope).
			double PeakRate = 0.0;
			const TArray<TSharedPtr<FJsonValue>>* Rate = nullptr;
			if (E->TryGetArrayField(TEXT("rateOverTime"), Rate)) for (const auto& Entry : *Rate) { const auto& Pair = Entry->AsArray(); if (Pair.Num() == 2) PeakRate = FMath::Max(PeakRate, Pair[1]->AsNumber()); }
			OverrideLiteral(Graph, TEXT("SpawnRate"), TEXT("SpawnRate"), F, FloatLit(PeakRate));

			const TArray<TSharedPtr<FJsonValue>>* Accel = nullptr;
			E->TryGetArrayField(TEXT("acceleration"), Accel);
			OverrideLiteral(Graph, TEXT("GravityForce"), TEXT("Gravity"), V3, Vec3Lit(JsonVec3(Accel)));
			OverrideLiteral(Graph, TEXT("Drag"), TEXT("Drag"), F, FloatLit(E->GetNumberField(TEXT("drag"))));

			// Spawn origin relative to the effect origin (the floor point under Source): without it every emitter starts on
			// the floor instead of at the nozzle / Source height.
			const TArray<TSharedPtr<FJsonValue>>* Pos = nullptr;
			if (E->TryGetArrayField(TEXT("position"), Pos)) OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Offset"), V3, Vec3Lit(JsonVec3(Pos)));
			const TSharedPtr<FJsonObject>* ShapeObj = nullptr;
			if (E->TryGetObjectField(TEXT("shape"), ShapeObj))
			{
				const FString Kind = (*ShapeObj)->GetStringField(TEXT("kind"));
				if (Kind == TEXT("sphere") || Kind == TEXT("disc")) OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Sphere Radius"), F, FloatLit((*ShapeObj)->GetNumberField(TEXT("radiusCm"))));
				else if (Kind == TEXT("cone")) { OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Cone Angle"), F, FloatLit((*ShapeObj)->GetNumberField(TEXT("angleDeg")))); }
				else if (Kind == TEXT("box")) { const auto* Ext = &(*ShapeObj)->GetArrayField(TEXT("extentsCm")); OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Box Size"), V3, Vec3Lit(JsonVec3(Ext))); }
				// 'point': ShapeLocation left at its template default (effectively a point for our purposes at radius 0 is not set -- logged via the module-not-targeted path is unnecessary here, template default is close enough).
			}
			const double SpeedAvg = (E->GetNumberField(TEXT("speedCmSMin")) + E->GetNumberField(TEXT("speedCmSMax"))) / 2.0;
			OverrideLiteral(Graph, TEXT("AddVelocity"), TEXT("Velocity Speed"), F, FloatLit(SpeedAvg));
			const TArray<TSharedPtr<FJsonValue>>* Dir = nullptr;
			if (E->TryGetArrayField(TEXT("direction"), Dir)) OverrideLiteral(Graph, TEXT("AddVelocity"), TEXT("Cone Axis"), V3, Vec3Lit(JsonVec3(Dir)));
		}
		else if (Template == TEXT("SimpleSpriteBurst"))
		{
			const TArray<TSharedPtr<FJsonValue>>* Pos = nullptr;
			if (E->TryGetArrayField(TEXT("position"), Pos)) OverrideLiteral(Graph, TEXT("ShapeLocation"), TEXT("Offset"), FNiagaraTypeDefinition::GetVec3Def(), Vec3Lit(JsonVec3(Pos)));
			const TArray<TSharedPtr<FJsonValue>>* Bursts = nullptr;
			if (E->TryGetArrayField(TEXT("bursts"), Bursts) && Bursts->Num() > 0)
			{
				const auto B0 = (*Bursts)[0]->AsObject();
				OverrideLiteral(Graph, TEXT("SpawnBurst_Instantaneous"), TEXT("Spawn Count"), FNiagaraTypeDefinition::GetIntDef(), FString::FromInt((int32)B0->GetNumberField(TEXT("count"))));
				OverrideLiteral(Graph, TEXT("SpawnBurst_Instantaneous"), TEXT("Spawn Time"), F, FloatLit(B0->GetNumberField(TEXT("tick")) / 60.0));
				if (Bursts->Num() > 1) UE_LOG(LogVfxImporter, Warning, TEXT("    %d extra burst(s) beyond the first are not exported to SpawnBurst_Instantaneous (one burst per module this pass)."), Bursts->Num() - 1);
			}
		}
		// 'Minimal': no spawn module exists on this template; see fromPlan.ts's report item for this case.
	}
}

bool UVfxNiagaraImporter::ImportPackage(const FString& PackageDir, const FString& DestPath)
{
	UE_LOG(LogVfxImporter, Warning, TEXT("=== ImportPackage(%s -> %s) ==="), *PackageDir, *DestPath);

	const FString JsonPath = PackageDir / TEXT("effect.json");
	FString JsonText;
	if (!FFileHelper::LoadFileToString(JsonText, *JsonPath))
	{
		UE_LOG(LogVfxImporter, Error, TEXT("Cannot read %s"), *JsonPath);
		return false;
	}
	TSharedPtr<FJsonObject> Root;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonText);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		UE_LOG(LogVfxImporter, Error, TEXT("Cannot parse %s"), *JsonPath);
		return false;
	}
	const FString Name = Root->GetStringField(TEXT("name"));
	UE_LOG(LogVfxImporter, Warning, TEXT("Effect: %s"), *Name);

	// --- Textures ---
	TMap<FString, UTexture2D*> Textures;
	const TArray<TSharedPtr<FJsonValue>>* TexList = nullptr;
	if (Root->TryGetArrayField(TEXT("textures"), TexList))
	{
		for (const auto& T : *TexList)
		{
			const FString File = T->AsString();
			const FString Disk = PackageDir / TEXT("Textures") / File;
			if (!FPaths::FileExists(Disk)) { UE_LOG(LogVfxImporter, Warning, TEXT("Texture not found in package: %s"), *Disk); continue; }
			if (UTexture2D* Tex = ImportTexture(Disk, DestPath)) Textures.Add(File, Tex);
		}
	}
	UMaterial* AdditiveBase = GetOrCreateBaseMaterial(DestPath, true);
	UMaterial* TranslucentBase = GetOrCreateBaseMaterial(DestPath, false);

	// --- NiagaraSystem ---
	// Emitters go in through the factory's EmittersToAddToNewSystem: that path (FNiagaraEditorUtilities::AddEmitterToSystem)
	// also wires each emitter into the system scripts. UNiagaraSystem::AddEmitterHandle alone does not, and such a system
	// has nothing running: it completes on its first tick and never draws (the 2026-10-01 "black frame").
	struct FPending { TSharedPtr<FJsonObject> E; FString Name; FString Template; };
	TArray<FPending> Pending;
	UNiagaraSystemFactoryNew* SysFactory = NewObject<UNiagaraSystemFactoryNew>();
	const TArray<TSharedPtr<FJsonValue>>* Emitters = nullptr;
	if (Root->TryGetArrayField(TEXT("emitters"), Emitters))
	{
		for (const auto& Item : *Emitters)
		{
			const TSharedPtr<FJsonObject> E = Item->AsObject();
			const FString EName = E->GetStringField(TEXT("name"));
			const FString Template = E->GetStringField(TEXT("suggestedTemplate"));
			const TCHAR* TemplatePath =
				Template == TEXT("SimpleSpriteBurst") ? TEXT("/Niagara/DefaultAssets/Templates/Emitters/SimpleSpriteBurst.SimpleSpriteBurst") :
				Template == TEXT("Minimal") ? TEXT("/Niagara/DefaultAssets/Templates/Emitters/Minimal.Minimal") :
				TEXT("/Niagara/DefaultAssets/Templates/Emitters/Fountain.Fountain");
			UNiagaraEmitter* Tmpl = LoadTemplate(TemplatePath);
			if (!Tmpl) { UE_LOG(LogVfxImporter, Error, TEXT("Skipping emitter %s: template load failed"), *EName); continue; }
			SysFactory->EmittersToAddToNewSystem.Add(FVersionedNiagaraEmitter(Tmpl, Tmpl->GetExposedVersion().VersionGuid));
			Pending.Add({ E, EName, Template });
		}
	}
	IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
	const FString SystemName = TEXT("NS_") + Name;
	UObject* NewAsset = AssetTools.CreateAsset(SystemName, DestPath, UNiagaraSystem::StaticClass(), SysFactory);
	UNiagaraSystem* System = Cast<UNiagaraSystem>(NewAsset);
	if (!System) { UE_LOG(LogVfxImporter, Error, TEXT("CreateAsset(NiagaraSystem) failed (may already exist at %s/%s)"), *DestPath, *SystemName); return false; }

	int32 EmitterCount = 0;
	TArray<FNiagaraEmitterHandle>& Handles = System->GetEmitterHandles();
	if (Handles.Num() != Pending.Num()) UE_LOG(LogVfxImporter, Error, TEXT("Expected %d emitters in the new system, found %d"), Pending.Num(), Handles.Num());
	for (int32 i = 0; i < FMath::Min(Handles.Num(), Pending.Num()); i++)
	{
		const TSharedPtr<FJsonObject> E = Pending[i].E;
		const FString& EName = Pending[i].Name;
		const FString& Template = Pending[i].Template;
		FNiagaraEmitterHandle& Handle = Handles[i];
		Handle.SetName(FName(*EName), *System);
		UE_LOG(LogVfxImporter, Warning, TEXT(" + emitter %s (template %s)"), *EName, *Template);

		FVersionedNiagaraEmitterData* Data = Handle.GetEmitterData();
		if (!Data) { UE_LOG(LogVfxImporter, Error, TEXT("   no emitter data for %s"), *EName); continue; }

		// Material: an MIC over the shared Additive/Translucent base, per the emitter's texture + blend mode.
		const FString Blend = E->GetStringField(TEXT("blend"));
		const bool bAdditive = Blend == TEXT("additive");
		FString TexFile; E->TryGetStringField(TEXT("textureFile"), TexFile);
		UTexture2D** FoundTex = TexFile.IsEmpty() ? nullptr : Textures.Find(TexFile);
		int32 Cols = 1, Rows = 1;
		const TSharedPtr<FJsonObject>* Flip = nullptr;
		if (E->TryGetObjectField(TEXT("flipbook"), Flip)) { Cols = (int32)(*Flip)->GetNumberField(TEXT("columns")); Rows = (int32)(*Flip)->GetNumberField(TEXT("rows")); }
		UMaterial* Base = (Cols > 1 || Rows > 1) ? GetOrCreateBaseMaterial(DestPath, bAdditive, Cols, Rows) : (bAdditive ? AdditiveBase : TranslucentBase);
		const FString Tag = FString(bAdditive ? TEXT("Add") : TEXT("Trans")) + ((Cols > 1 || Rows > 1) ? FString::Printf(TEXT("%dx%d"), Cols, Rows) : FString());
		UMaterialInstanceConstant* MIC = FoundTex ? GetOrCreateTextureMaterial(DestPath, Base, *FoundTex, Tag) : nullptr;
		for (UNiagaraRendererProperties* Renderer : Data->GetRenderers())
		{
			if (auto* Sprite = Cast<UNiagaraSpriteRendererProperties>(Renderer))
			{
				if (MIC) Sprite->Material = MIC;
				if (E->GetStringField(TEXT("alignment")) == TEXT("velocity")) Sprite->Alignment = ENiagaraSpriteAlignment::VelocityAligned;
				else UE_LOG(LogVfxImporter, Warning, TEXT("   no texture for %s; keeping the template's default sprite material"), *EName);
			}
		}

		UNiagaraScript* SpawnScript = Data->SpawnScriptProps.Script;
		UNiagaraScriptSource* Source = SpawnScript ? Cast<UNiagaraScriptSource>(SpawnScript->GetLatestSource()) : nullptr;
		if (Source && Source->NodeGraph) ApplyEmitterOverrides(Source->NodeGraph, E, Template);
		else UE_LOG(LogVfxImporter, Error, TEXT("   no spawn-script graph for %s; module overrides skipped"), *EName);

		EmitterCount++;
	}

	const TArray<TSharedPtr<FJsonValue>>* Ribbons = nullptr;
	const int32 RibbonCount = Root->TryGetArrayField(TEXT("ribbons"), Ribbons) ? Ribbons->Num() : 0;
	const TArray<TSharedPtr<FJsonValue>>* Lights = nullptr;
	const int32 LightCount = Root->TryGetArrayField(TEXT("lights"), Lights) ? Lights->Num() : 0;
	if (RibbonCount || LightCount)
	{
		UE_LOG(LogVfxImporter, Warning, TEXT("effect.json has %d ribbon layer(s) and %d light(s); this plugin pass does not build Niagara Ribbon/Light renderers yet (particle emitters only) -- see report.md for hand-authoring them."), RibbonCount, LightCount);
	}

	System->RequestCompile(true);
	UE_LOG(LogVfxImporter, Warning, TEXT("RequestCompile issued; waiting..."));
	System->WaitForCompilationComplete(true, false);
	UE_LOG(LogVfxImporter, Warning, TEXT("Compile wait returned. Outstanding=%d"), System->HasOutstandingCompilationRequests());

	const bool bSaved = SaveAssetObj(System);
	UE_LOG(LogVfxImporter, Warning, TEXT("=== ImportPackage done: %d emitter(s), saved=%d ==="), EmitterCount, bSaved ? 1 : 0);
	return bSaved && EmitterCount > 0;
}

void UVfxNiagaraImporter::DumpTemplates()
{
	const TCHAR* Paths[] = {
		TEXT("/Niagara/DefaultAssets/Templates/Emitters/Fountain.Fountain"),
		TEXT("/Niagara/DefaultAssets/Templates/Emitters/SimpleSpriteBurst.SimpleSpriteBurst"),
	};
	for (const TCHAR* Path : Paths)
	{
		UNiagaraEmitter* Tmpl = LoadTemplate(Path);
		FVersionedNiagaraEmitterData* Data = Tmpl ? Tmpl->GetEmitterData(Tmpl->GetExposedVersion().VersionGuid) : nullptr;
		if (!Data) continue;
		UNiagaraScriptSource* Source = Data->SpawnScriptProps.Script ? Cast<UNiagaraScriptSource>(Data->SpawnScriptProps.Script->GetLatestSource()) : nullptr;
		if (!Source || !Source->NodeGraph) continue;
		UE_LOG(LogVfxImporter, Warning, TEXT("DUMP template %s: %d nodes"), Path, Source->NodeGraph->Nodes.Num());
		for (UEdGraphNode* Node : Source->NodeGraph->Nodes)
		{
			FString Extra;
			if (UNiagaraNodeFunctionCall* Fn = Cast<UNiagaraNodeFunctionCall>(Node)) Extra = FString::Printf(TEXT("function=%s"), *Fn->GetFunctionName());
			if (UNiagaraNodeInput* In = Cast<UNiagaraNodeInput>(Node))
			{
				UNiagaraDataInterface* DI = NodeInputDataInterface(In);
				Extra = FString::Printf(TEXT("input=%s type=%s di=%s"), *In->Input.GetName().ToString(), *In->Input.GetType().GetName(), DI ? *DI->GetClass()->GetName() : TEXT("-"));
			}
			UE_LOG(LogVfxImporter, Warning, TEXT("DUMP   %s | %s | %s"), *Node->GetClass()->GetName(), *Node->GetNodeTitle(ENodeTitleType::ListView).ToString(), *Extra);
		}
	}
}
